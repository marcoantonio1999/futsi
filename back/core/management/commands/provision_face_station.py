import json
import secrets

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError

from core.face_station_auth import build_station_token
from core.models import FaceStationDevice, Site, User, UserRole


class Command(BaseCommand):
    help = "Crea o rota el token de una estacion facial desatendida."

    def add_arguments(self, parser):
        parser.add_argument("--site", required=True, help="Codigo o ID de la sede.")
        parser.add_argument("--name", required=True, help="Nombre visible de la estacion.")
        parser.add_argument("--camera-id", default="cancha_1")
        parser.add_argument("--service-user", default="")
        parser.add_argument("--rotate", action="store_true", help="Rota el token si la estacion ya existe.")
        parser.add_argument("--json", action="store_true", help="Imprime un JSON facil de copiar al instalador.")

    def handle(self, *args, **options):
        site_value = str(options["site"]).strip()
        site = Site.objects.filter(code=site_value).first()
        if not site and site_value.isdigit():
            site = Site.objects.filter(pk=int(site_value)).first()
        if not site:
            raise CommandError(f"No existe la sede {site_value}.")

        username = options["service_user"].strip() or f"face_station_{site.code}"
        service_user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "first_name": "Estacion facial",
                "last_name": site.name,
                "role": UserRole.SITE_COORDINATOR,
                "primary_site": site,
                "is_active": True,
            },
        )
        if created:
            service_user.set_unusable_password()
            service_user.save(update_fields=["password"])
        elif service_user.primary_site_id != site.id:
            raise CommandError("El usuario de servicio ya pertenece a otra sede.")

        device = FaceStationDevice.objects.filter(site=site, name=options["name"]).first()
        if device and not options["rotate"]:
            raise CommandError("La estacion ya existe. Usa --rotate para generar un token nuevo.")

        secret = secrets.token_urlsafe(32)
        if not device:
            device = FaceStationDevice(site=site, name=options["name"])
        device.service_user = service_user
        device.camera_id = options["camera_id"]
        device.secret_hash = make_password(secret)
        device.is_active = True
        device.save()
        token = build_station_token(device.public_id, secret)

        payload = {
            "device_id": str(device.public_id),
            "name": device.name,
            "site": site.code,
            "camera_id": device.camera_id,
            "station_token": token,
        }
        if options["json"]:
            self.stdout.write(json.dumps(payload, indent=2))
        else:
            self.stdout.write(self.style.SUCCESS("Estacion lista. El token solo se muestra una vez:"))
            self.stdout.write(token)
