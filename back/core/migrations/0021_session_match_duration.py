import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0020_attendance_uniqueness"),
    ]

    operations = [
        migrations.AddField(
            model_name="match",
            name="duration_minutes",
            field=models.PositiveSmallIntegerField(default=120, validators=[django.core.validators.MinValueValidator(1)]),
        ),
        migrations.AddField(
            model_name="attendancesession",
            name="duration_minutes",
            field=models.PositiveSmallIntegerField(default=120, validators=[django.core.validators.MinValueValidator(1)]),
        ),
    ]
