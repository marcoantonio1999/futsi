from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0093_game_role_round_rest_team")]

    operations = [
        migrations.AddField(
            model_name="gameroleround",
            name="extra_schedule",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
