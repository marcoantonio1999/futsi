from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0017_user_section_permissions"),
    ]

    operations = [
        migrations.AddField(
            model_name="attendancesession",
            name="match",
            field=models.ForeignKey(
                null=True,
                blank=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="attendance_sessions",
                to="core.match",
            ),
        ),
    ]
