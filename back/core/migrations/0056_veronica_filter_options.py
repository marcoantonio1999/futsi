from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0055_link_franco_whatsapp_channels"),
    ]

    operations = [
        migrations.CreateModel(
            name="VeronicaFilterOption",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("dimension", models.CharField(choices=[("platform", "Plataforma"), ("vacancy_type", "Tipo de vacante")], max_length=24)),
                ("label", models.CharField(max_length=80)),
                ("normalized_label", models.CharField(max_length=80)),
                ("is_active", models.BooleanField(default=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_veronica_filter_options", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "veronica_filter_options",
                "ordering": ["dimension", "label"],
            },
        ),
        migrations.AddConstraint(
            model_name="veronicafilteroption",
            constraint=models.UniqueConstraint(fields=("dimension", "normalized_label"), name="uq_veronica_filter_dimension_label"),
        ),
    ]
