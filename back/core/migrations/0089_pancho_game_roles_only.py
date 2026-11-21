from django.db import migrations


def restrict_pancho(apps, schema_editor):
    users = apps.get_model("core", "User").objects.using(schema_editor.connection.alias)
    account = users.filter(username__iexact="pancho.inscripciones").first()
    if not account:
        print("Pancho Inscripciones: cuenta no encontrada.")
        return
    grants = list(account.section_permissions or [])
    for permission in ("player_enrollments_only", "game_roles_only"):
        if permission not in grants:
            grants.append(permission)
    users.filter(pk=account.pk).update(section_permissions=grants)
    print("Pancho Inscripciones: permiso exclusivo de Roles de juego aplicado.")


class Migration(migrations.Migration):
    dependencies = [("core", "0088_student_guardian_optional")]

    operations = [migrations.RunPython(restrict_pancho)]
