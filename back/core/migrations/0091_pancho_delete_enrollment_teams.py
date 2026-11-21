from django.db import migrations


def grant_pancho_team_deletion(apps, schema_editor):
    users = apps.get_model("core", "User").objects.using(schema_editor.connection.alias)
    for account in users.filter(username__iexact="pancho.inscripciones").select_for_update():
        grants = list(account.section_permissions or [])
        if "player_enrollments_delete_teams" not in grants:
            account.section_permissions = [*grants, "player_enrollments_delete_teams"]
            account.save(update_fields=["section_permissions"])


class Migration(migrations.Migration):
    dependencies = [("core", "0090_pancho_enrollment_and_game_roles")]

    operations = [migrations.RunPython(grant_pancho_team_deletion, migrations.RunPython.noop)]
