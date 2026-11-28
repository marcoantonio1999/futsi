from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0095_game_role_repeated_crosses")]

    operations = [
        migrations.AddField(
            model_name="playerenrollment",
            name="discarded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
