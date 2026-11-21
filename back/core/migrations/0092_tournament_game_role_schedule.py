from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0091_pancho_delete_enrollment_teams")]

    operations = [
        migrations.AddField(
            model_name="tournament",
            name="game_role_schedule",
            field=models.JSONField(blank=True, default=None, null=True),
        ),
    ]
