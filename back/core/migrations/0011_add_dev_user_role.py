# Generated for Sprint 4 QA and developer access hardening.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_historicalimport_historicalimportrow_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[
                    ("admin", "Administrador"),
                    ("dev", "Dev App"),
                    ("accounting", "Contador"),
                    ("owner", "Direccion"),
                    ("site_coordinator", "Coordinador de sede"),
                    ("cashier", "Cajero"),
                    ("coach", "Coach"),
                    ("guardian", "Representante"),
                ],
                default="site_coordinator",
                max_length=32,
            ),
        ),
    ]
