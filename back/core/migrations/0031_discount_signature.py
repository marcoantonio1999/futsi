from django.db import migrations, models
import django.db.models.deletion


def backfill_discount_signature(apps, schema_editor):
    Discount = apps.get_model("core", "Discount")
    Discount.objects.filter(signed_by__isnull=True).update(signed_by_id=models.F("requested_by_id"), signed_at=models.F("created_at"))


def clear_discount_signature(apps, schema_editor):
    Discount = apps.get_model("core", "Discount")
    Discount.objects.update(signed_by=None, signed_at=None)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0030_unknown_attendance_daily_records"),
    ]

    operations = [
        migrations.AddField(
            model_name="discount",
            name="signed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="signed_discounts",
                to="core.user",
            ),
        ),
        migrations.AddField(
            model_name="discount",
            name="signed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_discount_signature, reverse_code=clear_discount_signature),
    ]
