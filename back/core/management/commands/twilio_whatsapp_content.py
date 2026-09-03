from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.whatsapp.interactive import InteractiveMessageError, ensure_interactive_templates


class Command(BaseCommand):
    help = "Crea o reutiliza las listas y botones interactivos de WhatsApp en Twilio."

    def add_arguments(self, parser):
        parser.add_argument(
            "action",
            choices=["setup"],
            help="setup prepara el contenido interactivo reutilizable.",
        )
        parser.add_argument(
            "--max-list-options",
            type=int,
            default=6,
            help="Cantidad máxima de opciones que se preparará (1-10).",
        )

    def handle(self, *args, **options):
        if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
            raise CommandError("Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN.")
        maximum = options["max_list_options"]
        if not 1 <= maximum <= 10:
            raise CommandError("--max-list-options debe estar entre 1 y 10.")
        try:
            templates = ensure_interactive_templates(max_list_options=maximum)
        except InteractiveMessageError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            self.style.SUCCESS(
                f"WhatsApp interactivo listo: {len(templates)} plantillas reutilizables."
            )
        )
