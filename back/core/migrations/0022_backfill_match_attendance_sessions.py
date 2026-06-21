from django.db import migrations


def backfill_match_sessions(apps, schema_editor):
    AttendanceSession = apps.get_model("core", "AttendanceSession")
    Match = apps.get_model("core", "Match")
    User = apps.get_model("core", "User")

    captured_by = (
        User.objects.filter(role__in=["admin", "dev", "owner"]).order_by("id").first()
        or User.objects.filter(is_superuser=True).order_by("id").first()
        or User.objects.order_by("id").first()
    )
    if not captured_by:
        return

    for match in Match.objects.select_related("site", "tournament", "round", "home_team", "away_team").all():
        for team in [match.home_team, match.away_team]:
            session, created = AttendanceSession.objects.get_or_create(
                match=match,
                team=team,
                defaults={
                    "site": match.site,
                    "session_type": "tournament_match",
                    "date": match.played_on,
                    "starts_at": match.starts_at,
                    "duration_minutes": match.duration_minutes,
                    "tournament": match.tournament,
                    "round": match.round,
                    "group_name": team.name,
                    "captured_by": captured_by,
                },
            )
            if not created:
                session.site = match.site
                session.session_type = "tournament_match"
                session.date = match.played_on
                session.starts_at = match.starts_at
                session.duration_minutes = match.duration_minutes
                session.tournament = match.tournament
                session.round = match.round
                session.group_name = team.name
                session.save(update_fields=["site", "session_type", "date", "starts_at", "duration_minutes", "tournament", "round", "group_name", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0021_session_match_duration"),
    ]

    operations = [
        migrations.RunPython(backfill_match_sessions, migrations.RunPython.noop),
    ]
