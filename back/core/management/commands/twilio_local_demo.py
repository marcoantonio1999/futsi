import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from requests.exceptions import RequestException
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client


ACCOUNT_SID_RE = re.compile(r"^AC[0-9a-fA-F]{32}$")
AUTH_TOKEN_RE = re.compile(r"^[0-9a-fA-F]{32}$")
PHONE_SID_RE = re.compile(r"^PN[0-9a-fA-F]{32}$")
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")

DEFAULT_BACKUP_PATH = Path(settings.BASE_DIR) / ".twilio-local-demo-backup.json"
DEFAULT_ARCHIVE_DIR = Path(settings.BASE_DIR) / ".twilio-local-demo-backups"
BACKUP_VERSION = 1
CONFIGURATION_FIELDS = (
    "voice_url",
    "voice_method",
    "status_callback",
    "status_callback_method",
)


def _credentials_from_environment() -> tuple[str, str]:
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
    if not ACCOUNT_SID_RE.fullmatch(account_sid):
        raise CommandError(
            "TWILIO_ACCOUNT_SID falta o no tiene el formato esperado. "
            "Configúralo únicamente como variable de entorno."
        )
    if not AUTH_TOKEN_RE.fullmatch(auth_token):
        raise CommandError(
            "TWILIO_AUTH_TOKEN falta o no tiene el formato esperado. "
            "Configúralo únicamente como variable de entorno."
        )
    return account_sid, auth_token


def _validated_base_url(raw_value: str) -> str:
    value = raw_value.strip()
    if not value or any(char.isspace() for char in value) or "\\" in value:
        raise CommandError("--base-url debe ser un origen HTTPS válido.")

    parsed = urlsplit(value)
    try:
        parsed.port
    except ValueError as exc:
        raise CommandError("--base-url contiene un puerto inválido.") from exc

    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise CommandError(
            "--base-url debe ser únicamente un origen HTTPS, por ejemplo "
            "https://demo.example.test."
        )
    return f"https://{parsed.netloc}".rstrip("/")


def _resource_configuration(resource) -> dict[str, str | None]:
    configuration = {}
    for field in CONFIGURATION_FIELDS:
        value = getattr(resource, field, None)
        if value is not None and not isinstance(value, str):
            raise CommandError(
                f"Twilio devolvió un valor inesperado para {field}; no se modificó nada."
            )
        configuration[field] = value
    return configuration


def _normalized_configuration(configuration: dict) -> dict[str, str]:
    return {
        field: configuration.get(field) or ""
        for field in CONFIGURATION_FIELDS
    }


def _assert_direct_voice_configuration(resource) -> None:
    if getattr(resource, "trunk_sid", None):
        raise CommandError(
            "El número usa un SIP Trunk (trunk_sid). Se abortó para no reemplazar "
            "una integración existente."
        )
    if getattr(resource, "voice_application_sid", None):
        raise CommandError(
            "El número usa una TwiML App (voice_application_sid). Se abortó para "
            "no reemplazar una integración existente."
        )


def _phone_number_from_environment(*, required: bool) -> str:
    phone_number = os.environ.get("TWILIO_PHONE_NUMBER", "").strip()
    if not phone_number and not required:
        return ""
    if not E164_RE.fullmatch(phone_number):
        raise CommandError(
            "TWILIO_PHONE_NUMBER falta o no está en formato E.164 "
            "(por ejemplo, +15551234567)."
        )
    return phone_number


def _fetch_number(client: Client, sid: str):
    resource = client.incoming_phone_numbers(sid).fetch()
    if getattr(resource, "sid", None) != sid:
        raise CommandError("Twilio devolvió un número distinto al solicitado.")
    return resource


def _discover_number(client: Client, phone_sid: str):
    if phone_sid:
        if not PHONE_SID_RE.fullmatch(phone_sid):
            raise CommandError("--phone-sid no tiene un SID PN válido.")
        resource = _fetch_number(client, phone_sid)
        expected_phone = _phone_number_from_environment(required=False)
        if expected_phone and getattr(resource, "phone_number", None) != expected_phone:
            raise CommandError(
                "El --phone-sid no corresponde a TWILIO_PHONE_NUMBER; no se "
                "modificó nada."
            )
        return resource

    phone_number = _phone_number_from_environment(required=True)
    matches = client.incoming_phone_numbers.list(
        phone_number=phone_number,
        limit=2,
    )
    if not matches:
        raise CommandError(
            "No se encontró TWILIO_PHONE_NUMBER en la cuenta configurada."
        )
    if len(matches) != 1:
        raise CommandError(
            "Twilio devolvió más de un número; usa --phone-sid para seleccionar "
            "el recurso exacto."
        )
    sid = getattr(matches[0], "sid", "")
    if not PHONE_SID_RE.fullmatch(sid):
        raise CommandError("Twilio devolvió un SID de número inválido.")
    resource = _fetch_number(client, sid)
    if getattr(resource, "phone_number", None) != phone_number:
        raise CommandError(
            "Twilio devolvió un número distinto a TWILIO_PHONE_NUMBER."
        )
    return resource


def _write_backup(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
        )
    except FileExistsError as exc:
        raise CommandError(
            f"Ya existe un respaldo pendiente en {path}. Ejecuta restore antes "
            "de volver a configurar."
        ) from exc
    except OSError as exc:
        raise CommandError(f"No se pudo crear el respaldo local en {path}.") from exc

    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _read_backup(path: Path) -> dict:
    try:
        raw_payload = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise CommandError(
            f"No existe un respaldo pendiente en {path}; no hay nada que restaurar."
        ) from exc
    except OSError as exc:
        raise CommandError(f"No se pudo leer el respaldo local en {path}.") from exc

    try:
        payload = json.loads(raw_payload)
    except (TypeError, json.JSONDecodeError) as exc:
        raise CommandError("El respaldo local no contiene JSON válido.") from exc

    expected_keys = {
        "version",
        "created_at",
        "account_sid",
        "phone_sid",
        "phone_number",
        "original_configuration",
        "demo_configuration",
    }
    if not isinstance(payload, dict) or set(payload) != expected_keys:
        raise CommandError("El respaldo local tiene una estructura inesperada.")
    if payload["version"] != BACKUP_VERSION:
        raise CommandError("La versión del respaldo local no es compatible.")
    if not ACCOUNT_SID_RE.fullmatch(str(payload["account_sid"])):
        raise CommandError("El respaldo contiene un Account SID inválido.")
    if not PHONE_SID_RE.fullmatch(str(payload["phone_sid"])):
        raise CommandError("El respaldo contiene un Phone SID inválido.")
    if not E164_RE.fullmatch(str(payload["phone_number"])):
        raise CommandError("El respaldo contiene un teléfono inválido.")

    for key in ("original_configuration", "demo_configuration"):
        configuration = payload[key]
        if not isinstance(configuration, dict) or set(configuration) != set(
            CONFIGURATION_FIELDS
        ):
            raise CommandError(
                f"El respaldo contiene una configuración {key} inválida."
            )
        if any(
            value is not None and not isinstance(value, str)
            for value in configuration.values()
        ):
            raise CommandError(
                f"El respaldo contiene valores {key} inválidos."
            )
    return payload


def _archive_backup(path: Path, archive_dir: Path, *, current_account_sid: str) -> Path:
    payload = _read_backup(path)
    if payload["account_sid"] == current_account_sid:
        raise CommandError(
            "El respaldo pertenece a la cuenta actual. Ejecuta restore; no se archivó nada."
        )

    try:
        created_at = datetime.fromisoformat(str(payload["created_at"]))
    except (TypeError, ValueError) as exc:
        raise CommandError("El respaldo contiene una fecha de creación inválida.") from exc
    if created_at.tzinfo is None:
        raise CommandError("El respaldo contiene una fecha de creación sin zona horaria.")

    stamp = created_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    account_suffix = str(payload["account_sid"])[-8:]
    phone_suffix = str(payload["phone_sid"])[-8:]
    archive_path = archive_dir / (
        f"twilio-backup-{stamp}-{account_suffix}-{phone_suffix}.json"
    )
    _write_backup(archive_path, payload)
    try:
        path.unlink()
    except OSError as exc:
        raise CommandError(
            "El respaldo se copió al archivo histórico, pero no se pudo retirar "
            f"el respaldo activo en {path}. No se modificó Twilio."
        ) from exc
    return archive_path


def _restore_backup_path(raw_value: str) -> Path:
    if not raw_value:
        return DEFAULT_BACKUP_PATH

    try:
        candidate = Path(raw_value).expanduser().resolve(strict=True)
        archive_dir = DEFAULT_ARCHIVE_DIR.resolve(strict=False)
    except OSError as exc:
        raise CommandError("No se pudo resolver --backup-file.") from exc
    if (
        candidate.parent != archive_dir
        or candidate.suffix.lower() != ".json"
        or not candidate.is_file()
    ):
        raise CommandError(
            "--backup-file debe ser un archivo JSON hijo directo de "
            f"{DEFAULT_ARCHIVE_DIR}."
        )
    return candidate


class Command(BaseCommand):
    help = (
        "Configura temporalmente un número de Twilio para la demo local y lo "
        "restaura desde un respaldo seguro."
    )

    def add_arguments(self, parser):
        actions = parser.add_subparsers(dest="action", required=True)

        configure = actions.add_parser(
            "configure",
            help="Respalda y configura los webhooks de la demo.",
        )
        configure.add_argument(
            "--base-url",
            required=True,
            help="Origen HTTPS público del túnel, sin ruta.",
        )
        configure.add_argument(
            "--phone-sid",
            default="",
            help=(
                "SID PN opcional. Sin esta opción se busca TWILIO_PHONE_NUMBER "
                "en la cuenta."
            ),
        )
        preflight = actions.add_parser(
            "preflight",
            help="Valida cuenta y número sin modificar Twilio ni respaldos.",
        )
        preflight.add_argument(
            "--phone-sid",
            default="",
            help=(
                "SID PN opcional. Sin esta opción se busca TWILIO_PHONE_NUMBER "
                "en la cuenta."
            ),
        )
        restore = actions.add_parser(
            "restore",
            help="Restaura exactamente los webhooks guardados y elimina el respaldo.",
        )
        restore.add_argument(
            "--backup-file",
            default="",
            help=(
                "Respaldo archivado opcional. Debe ser un JSON hijo directo de "
                f"{DEFAULT_ARCHIVE_DIR}."
            ),
        )
        actions.add_parser(
            "archive-other-account-backup",
            help=(
                "Archiva un respaldo perteneciente a otra cuenta sin modificar "
                "Twilio."
            ),
        )

    def handle(self, *args, **options):
        account_sid, auth_token = _credentials_from_environment()
        if options["action"] == "archive-other-account-backup":
            archive_path = _archive_backup(
                DEFAULT_BACKUP_PATH,
                DEFAULT_ARCHIVE_DIR,
                current_account_sid=account_sid,
            )
            self.stdout.write(
                self.style.WARNING(
                    "Respaldo de la cuenta anterior conservado en "
                    f"{archive_path}. Esa cuenta no fue restaurada. Para recuperarla, "
                    "usa sus propias credenciales y ejecuta restore --backup-file "
                    f'"{archive_path}".'
                )
            )
            return
        try:
            client = Client(account_sid, auth_token)
            if options["action"] == "configure":
                self._configure(
                    client=client,
                    account_sid=account_sid,
                    base_url=_validated_base_url(options["base_url"]),
                    phone_sid=options["phone_sid"].strip(),
                )
            elif options["action"] == "preflight":
                resource = _discover_number(client, options["phone_sid"].strip())
                _assert_direct_voice_configuration(resource)
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Cuenta y número de Twilio validados: {resource.phone_number}."
                    )
                )
            else:
                self._restore(
                    client=client,
                    account_sid=account_sid,
                    backup_path=_restore_backup_path(options["backup_file"].strip()),
                )
        except TwilioRestException as exc:
            status = getattr(exc, "status", "desconocido")
            code = getattr(exc, "code", None)
            suffix = f", código {code}" if code is not None else ""
            raise CommandError(
                f"Twilio rechazó la operación (HTTP {status}{suffix}). "
                "El Auth Token no se mostró ni se guardó."
            ) from exc
        except RequestException as exc:
            raise CommandError(
                "No se pudo conectar con api.twilio.com. Revisa la conexión y el DNS; "
                "las credenciales no se mostraron ni se guardaron."
            ) from exc

    def _configure(
        self,
        *,
        client: Client,
        account_sid: str,
        base_url: str,
        phone_sid: str,
    ) -> None:
        if DEFAULT_BACKUP_PATH.exists():
            raise CommandError(
                f"Ya existe un respaldo pendiente en {DEFAULT_BACKUP_PATH}. "
                "Ejecuta restore antes de volver a configurar."
            )

        resource = _discover_number(client, phone_sid)
        _assert_direct_voice_configuration(resource)

        demo_configuration = {
            "voice_url": f"{base_url}/api/voice/twilio/incoming/",
            "voice_method": "POST",
            "status_callback": f"{base_url}/api/voice/twilio/status/",
            "status_callback_method": "POST",
        }
        backup = {
            "version": BACKUP_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "account_sid": account_sid,
            "phone_sid": resource.sid,
            "phone_number": resource.phone_number,
            "original_configuration": _resource_configuration(resource),
            "demo_configuration": demo_configuration,
        }
        _write_backup(DEFAULT_BACKUP_PATH, backup)

        client.incoming_phone_numbers(resource.sid).update(**demo_configuration)
        verified = _fetch_number(client, resource.sid)
        _assert_direct_voice_configuration(verified)
        if _normalized_configuration(
            _resource_configuration(verified)
        ) != _normalized_configuration(demo_configuration):
            raise CommandError(
                "Twilio no confirmó todos los webhooks. El respaldo se conservó; "
                "ejecuta restore antes de reintentar."
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Twilio listo para la demo local en {resource.phone_number}. "
                f"Respaldo: {DEFAULT_BACKUP_PATH}"
            )
        )

    def _restore(
        self,
        *,
        client: Client,
        account_sid: str,
        backup_path: Path,
    ) -> None:
        backup = _read_backup(backup_path)
        if backup["account_sid"] != account_sid:
            raise CommandError(
                "El respaldo pertenece a otra cuenta de Twilio; no se modificó nada."
            )

        resource = _fetch_number(client, backup["phone_sid"])
        if resource.phone_number != backup["phone_number"]:
            raise CommandError(
                "El Phone SID del respaldo ahora corresponde a otro número; "
                "no se modificó nada."
            )
        _assert_direct_voice_configuration(resource)

        original = backup["original_configuration"]
        demo = backup["demo_configuration"]
        current = _normalized_configuration(_resource_configuration(resource))
        normalized_original = _normalized_configuration(original)
        normalized_demo = _normalized_configuration(demo)
        if current == normalized_original:
            restored_resource = resource
        elif current == normalized_demo:
            restore_values = {
                field: value if value is not None else ""
                for field, value in original.items()
            }
            client.incoming_phone_numbers(resource.sid).update(**restore_values)
            restored_resource = _fetch_number(client, resource.sid)
            _assert_direct_voice_configuration(restored_resource)
        else:
            raise CommandError(
                "La configuración de Twilio cambió después de iniciar la demo. "
                "No se sobrescribió ese cambio y el respaldo se conservó."
            )

        if _normalized_configuration(
            _resource_configuration(restored_resource)
        ) != normalized_original:
            raise CommandError(
                "Twilio no confirmó la restauración completa. El respaldo se "
                "conservó para volver a intentarlo."
            )
        try:
            backup_path.unlink()
        except OSError as exc:
            raise CommandError(
                "Twilio fue restaurado, pero no se pudo eliminar el respaldo "
                f"local en {backup_path}. Elimínalo manualmente."
            ) from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"Configuración original restaurada para {resource.phone_number}; "
                "respaldo local eliminado."
            )
        )
