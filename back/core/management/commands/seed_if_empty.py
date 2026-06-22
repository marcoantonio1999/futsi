import os

from django.conf import settings
from django.core.management import BaseCommand, call_command

from core.models import Site


class Command(BaseCommand):
    help = "Carga datos demo solo si la base operativa esta vacia."

    def handle(self, *args, **options):
        force_seed = os.getenv("RUN_SEED_DEMO", "false").lower() == "true"
        allow_production_seed = os.getenv("ALLOW_PRODUCTION_SEED", "false").lower() == "true"
        is_production = not settings.DEBUG or bool(
            os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID") or os.getenv("RENDER_EXTERNAL_HOSTNAME")
        )
        auto_seed_default = "false" if is_production else "true"
        auto_seed = os.getenv("AUTO_SEED_IF_EMPTY", auto_seed_default).lower() == "true"

        if force_seed:
            if is_production and not allow_production_seed:
                self.stdout.write(
                    "RUN_SEED_DEMO=true ignorado en produccion. Usa ALLOW_PRODUCTION_SEED=true si realmente quieres sembrar demo."
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
