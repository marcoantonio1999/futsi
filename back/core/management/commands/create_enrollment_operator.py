from getpass import getpass
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from core.models import User


class Command(BaseCommand):
    help = "Crea una cuenta independiente para gestionar inscripciones, sin permisos administrativos."
    def add_arguments(self, parser):
        parser.add_argument("--username", default="emilio")
    def handle(self, *args, **options):
        username = options["username"]
        if User.objects.filter(username=username).exists():
            raise CommandError("El usuario ya existe. No se modificó su acceso ni contraseña.")
        password = getpass("Contraseña de la nueva cuenta: ")
        if password != getpass("Repite la contraseña: "):
            raise CommandError("Las contraseñas no coinciden.")
        user = User(username=username, first_name="Emilio", email="", role="collaborator", primary_site=None, section_permissions=["player_enrollments_only"])
        validate_password(password, user)
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Cuenta {username} creada con acceso solo a inscripciones."))
