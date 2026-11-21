import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0092_tournament_game_role_schedule")]

    operations = [
        migrations.AddField(
            model_name="gameroleround",
            name="rest_team",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="game_role_rest_rounds", to="core.team",
            ),
        ),
    ]
