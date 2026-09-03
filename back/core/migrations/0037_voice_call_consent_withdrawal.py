from django.db import migrations, models


class Migration(migrations.Migration):
    replaces = [("core", "0034_voice_call_consent_withdrawal")]

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
