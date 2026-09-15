from django.db import migrations, models


def secure_table(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('ALTER TABLE whatsapp_channel_documents ENABLE ROW LEVEL SECURITY')
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
        for (role,) in cursor.fetchall():
            schema_editor.execute(f'REVOKE ALL ON whatsapp_channel_documents FROM "{role}"')


class Migration(migrations.Migration):
    dependencies = [('core', '0052_bulk_contact_names')]
    operations = [
        migrations.CreateModel(
            name='WhatsAppChannelDocument',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('channel', models.CharField(max_length=64, unique=True)),
                ('enabled', models.BooleanField(default=False)),
                ('filename', models.CharField(max_length=120, blank=True)),
                ('caption', models.CharField(max_length=1024, blank=True)),
                ('content', models.BinaryField(default=bytes, editable=False)),
                ('sha256', models.CharField(max_length=64, blank=True)),
                ('updated_by_id', models.BigIntegerField(null=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ], options={'db_table': 'whatsapp_channel_documents', 'managed': True}),
        migrations.RunPython(secure_table, migrations.RunPython.noop),
    ]
