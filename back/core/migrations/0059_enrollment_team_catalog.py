from django.db import migrations, models
import django.db.models.deletion


def link_existing(apps, schema_editor):
    alias = schema_editor.connection.alias
    Team = apps.get_model('core','Team')
    for model_name in ('PlayerEnrollmentInvitation','PlayerEnrollment'):
        Model = apps.get_model('core',model_name)
        for row in Model.objects.using(alias).filter(team_record__isnull=True).iterator():
            matches = list(Team.objects.using(alias).filter(name=row.team, tournament__name=row.tournament).values_list('id', flat=True)[:2])
            if len(matches) == 1:
                Model.objects.using(alias).filter(pk=row.pk).update(team_record_id=matches[0])


class Migration(migrations.Migration):
    dependencies = [('core','0058_enrollment_identity_roster')]
    operations = [
        migrations.AddField(model_name='playerenrollmentinvitation', name='team_record', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='player_enrollment_invitations', to='core.team')),
        migrations.AddField(model_name='playerenrollment', name='team_record', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='signed_player_enrollments', to='core.team')),
        migrations.AlterField(model_name='playerenrollmentinvitation', name='team', field=models.CharField(blank=True, max_length=140)),
        migrations.AlterField(model_name='playerenrollmentinvitation', name='tournament', field=models.CharField(blank=True, max_length=140)),
        migrations.AlterField(model_name='playerenrollment', name='team', field=models.CharField(max_length=140)),
        migrations.AlterField(model_name='playerenrollment', name='tournament', field=models.CharField(blank=True, max_length=140)),
        migrations.AlterField(model_name='playerenrollment', name='category', field=models.CharField(blank=True, default='', max_length=80)),
        migrations.RunPython(link_existing, migrations.RunPython.noop),
    ]
