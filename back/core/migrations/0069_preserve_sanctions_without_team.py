from django.db import migrations, models
import django.db.models.deletion


def preserve_origin(apps, schema_editor):
    Sanction = apps.get_model('core', 'PlayerSanction')
    database = schema_editor.connection.alias
    rows = Sanction.objects.using(database).select_related('team__tournament__site')
    for row in rows.iterator(chunk_size=500):
        if row.team_id:
            Sanction.objects.using(database).filter(pk=row.pk).update(
                origin_site_id=row.team.tournament.site_id,
                origin_site=row.team.tournament.site.name,
                origin_tournament=row.team.tournament.name,
                origin_team=row.team.name)


class Migration(migrations.Migration):
    dependencies = [('core', '0068_sanction_appeals_payments')]
    operations = [
        migrations.AddField(model_name='playersanction', name='origin_site_id', field=models.BigIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='playersanction', name='origin_site', field=models.CharField(blank=True, default='', max_length=160)),
        migrations.AddField(model_name='playersanction', name='origin_tournament', field=models.CharField(blank=True, default='', max_length=140)),
        migrations.AddField(model_name='playersanction', name='origin_team', field=models.CharField(blank=True, default='', max_length=140)),
        migrations.RunPython(preserve_origin, migrations.RunPython.noop),
        migrations.AlterField(model_name='playersanction', name='team',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='sanctions', to='core.team')),
    ]
