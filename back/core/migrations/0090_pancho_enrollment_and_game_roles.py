from django.db import migrations


def grant_pancho_game_role_management(apps, schema_editor):
    users = apps.get_model("core", "User").objects.using(schema_editor.connection.alias)
    for account in users.filter(username__iexact="pancho.inscripciones").select_for_update():
        grants = [permission for permission in account.section_permissions or [] if permission != "game_roles_only"]
        for permission in ("player_enrollments_only", "game_roles_manage"):
            if permission not in grants:
                grants.append(permission)
        account.section_permissions = grants
        account.save(update_fields=["section_permissions"])


class Migration(migrations.Migration):
    dependencies = [("core", "0089_pancho_game_roles_only")]

    operations = [migrations.RunPython(grant_pancho_game_role_management, migrations.RunPython.noop)]
