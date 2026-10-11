from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from core.api.face_station_reports import _normalize_daily_payload
from core.models import FaceStationDailyPresence, FaceStationDailyReport
from .factories import make_player, make_site, make_team, make_tournament, make_student
from .test_face_station_reports import daily_payload, known_row, report_station, station_headers

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def player_row(player, detections=10):
    return {
        "subject_kind": "known", "subject_key": f"player:{player.id}",
        "canonical_person_key": f"player:{player.id}", "name": "Untrusted local name",
        "person_type": "player", "session_count": 1, "detection_count": detections,
    }


def test_deleted_tournament_does_not_block_update_of_validated_historical_report(api_client, report_station):
    tournament = make_tournament(site=report_station["site"])
    player = make_player(team=make_team(tournament=tournament), full_name="Historical player")
    day = timezone.localdate() - timedelta(days=3)
    first = api_client.put("/api/face-station/reports/daily/",
        daily_payload(day, [player_row(player)]), format="json", **station_headers(report_station))
    assert first.status_code == 201
    report = FaceStationDailyReport.objects.get()
    player.team.delete()
    tournament.delete()
    player.refresh_from_db()
    assert player.team_id is None
    changed = api_client.put("/api/face-station/reports/daily/",
        daily_payload(day, [player_row(player, 22)], revision=2,
            base_revision=report.revision, base_payload_sha256=report.payload_sha256),
        format="json", **station_headers(report_station))
    assert changed.status_code == 200, changed.content
    presence = FaceStationDailyPresence.objects.get()
    assert presence.name == "Historical player"
    assert presence.detection_count == 22
    # Historical validation cannot authorize a brand-new day.
    new_day = api_client.put("/api/face-station/reports/daily/",
        daily_payload(day + timedelta(days=1), [player_row(player)]),
        format="json", **station_headers(report_station))
    assert new_day.status_code == 400


def test_orphan_and_other_site_players_cannot_borrow_a_historical_snapshot(api_client, report_station):
    tournament = make_tournament(site=report_station["site"])
    player = make_player(team=make_team(tournament=tournament))
    day = timezone.localdate()
    result = api_client.put("/api/face-station/reports/daily/",
        daily_payload(day, [player_row(player)]), format="json", **station_headers(report_station))
    assert result.status_code == 201
    report = FaceStationDailyReport.objects.get()
    foreign_team = make_team(tournament=make_tournament(site=make_site()))
    player.team = foreign_team
    player.save(update_fields=["team"])
    result = api_client.put("/api/face-station/reports/daily/",
        daily_payload(day, [player_row(player, 40)], revision=2,
            base_revision=report.revision, base_payload_sha256=report.payload_sha256),
        format="json", **station_headers(report_station))
    assert result.status_code == 400
    never_validated = make_player(team=foreign_team)
    never_validated.team = None
    never_validated.save(update_fields=["team"])
    result = api_client.put("/api/face-station/reports/daily/",
        daily_payload(day, [player_row(never_validated)]),
        format="json", **station_headers(report_station))
    assert result.status_code == 400
    assert FaceStationDailyPresence.objects.get().detection_count == 10


def test_report_validation_is_batched_not_one_query_per_person(report_station):
    students = [make_student(site=report_station["site"]) for _ in range(25)]
    with CaptureQueriesContext(connection) as queries:
        payload = _normalize_daily_payload(report_station["device"],
            daily_payload(timezone.localdate(), [known_row(student) for student in students]))
    assert len(payload["rows"]) == 25
    assert len(queries) == 1


def test_historical_snapshot_cannot_be_borrowed_from_another_station(report_station):
    from .factories import make_user
    from core.models import FaceStationDevice
    tournament = make_tournament(site=report_station["site"])
    player = make_player(team=make_team(tournament=tournament))
    other_user = make_user(role="site_coordinator", primary_site=report_station["site"])
    other = FaceStationDevice.objects.create(name="Other", site=report_station["site"],
        service_user=other_user, camera_id="other", secret_hash="unused")
    day = timezone.localdate()
    report = FaceStationDailyReport.objects.create(device=other, site=report_station["site"],
        report_date=day, revision=1, payload_sha256="hash", generated_at=timezone.now())
    FaceStationDailyPresence.objects.create(report=report, subject_kind="known",
        subject_key=f"player:{player.id}", canonical_person_key=f"player:{player.id}",
        name="Other station", person_type="player")
    player.team.delete()
    tournament.delete()
    with pytest.raises(ValueError, match="no pertenece"):
        _normalize_daily_payload(report_station["device"], daily_payload(day, [player_row(player)]))

