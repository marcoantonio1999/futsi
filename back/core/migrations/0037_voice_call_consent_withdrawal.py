from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0036_trial_dashboard_voice_calls"),
    ]

    operations = [
        migrations.AddField(
            model_name="voicecall",
            name="consent_withdrawn_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
