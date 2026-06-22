import os

from django.core.management import BaseCommand, call_command

from core.models import Site


class Command(BaseCommand):
    help = "Carga datos demo solo si la base operativa esta vacia."

    def handle(self, *args, **options):
        force_seed = os.getenv("RUN_SEED_DEMO", "false").lower() == "true"
        auto_seed = os.getenv("AUTO_SEED_IF_EMPTY", "true").lower() == "true"

        if force_seed:
            self.stdout.write("RUN_SEED_DEMO=true; cargando datos demo.")
            call_command("seed_demo")
            return

        if auto_seed and not Site.objects.exists():
            self.stdout.write("Base sin sedes; cargando datos demo iniciales.")
            call_command("seed_demo")
            return

        self.stdout.write("Datos existentes detectados; no se carga demo.")
