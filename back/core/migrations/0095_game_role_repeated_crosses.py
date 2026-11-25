from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("core", "0094_game_role_round_extra_schedule")]

    operations = [
        migrations.RemoveConstraint(model_name="gamerolecross", name="uq_game_role_cross"),
    ]
