from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0051_whatsapp_bulk')]
    operations = [migrations.AddField(
        model_name='whatsappbulkrecipient', name='name',
        field=models.CharField(max_length=120, blank=True, default='', db_default=''),
    )]
