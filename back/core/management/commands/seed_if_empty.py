import os

from django.conf import settings
from django.core.management import BaseCommand, call_command

from core.models import Site


class Command(BaseCommand):
    help = "Carga datos demo solo si la base operativa esta vacia."

    def handle(self, *args, **options):
        debug = os.getenv("DJANGO_DEBUG", str(settings.DEBUG)).lower() in {"1", "true", "yes", "si", "on"}
        futsi_env = os.getenv("FUTSI_ENV", getattr(settings, "FUTSI_ENV", "local" if debug else "production")).lower()
        force_seed = os.getenv("RUN_SEED_DEMO", "false").lower() == "true"
        is_render = bool(
            os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") or os.getenv("RENDER_EXTERNAL_HOSTNAME")
        )
        is_production = futsi_env == "production"
        auto_seed_default = "false" if is_production or is_render or not debug else "true"
        auto_seed = os.getenv("AUTO_SEED_IF_EMPTY", auto_seed_default).lower() == "true"

        if force_seed:
            if is_production:
                self.stdout.write(
                    "RUN_SEED_DEMO=true ignorado en FUTSI_ENV=production. Produccion nunca carga datos demo."
                )
                return
            self.stdout.write("RUN_SEED_DEMO=true; cargando datos demo.")
            call_command("seed_demo")
            return

        if auto_seed and not Site.objects.exists():
            self.stdout.write("Base sin sedes; cargando datos demo iniciales.")
            call_command("seed_demo")
            return

        self.stdout.write("Datos existentes detectados; no se carga demo.")
