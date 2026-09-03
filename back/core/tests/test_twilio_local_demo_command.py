import json
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from core.management.commands import twilio_local_demo


ACCOUNT_SID = "AC" + ("1" * 32)
OTHER_ACCOUNT_SID = "AC" + ("3" * 32)
AUTH_TOKEN = "a" * 32
PHONE_SID = "PN" + ("2" * 32)
PHONE_NUMBER = "+15551234567"
BASE_URL = "https://futsi-demo.example.test"


class FakeIncomingPhoneNumbers:
    def __init__(self, resource):
        self.resource = resource
        self.list_calls = []
        self.update_calls = []

    def __call__(self, sid):
        if sid != self.resource.sid:
            raise AssertionError(f"SID inesperado: {sid}")
        return self

    def list(self, **kwargs):
        self.list_calls.append(kwargs)
        return [self.resource]

    def fetch(self):
        return self.resource

    def update(self, **kwargs):
        self.update_calls.append(kwargs)
        for key, value in kwargs.items():
            setattr(self.resource, key, value or None)
        return self.resource


def _resource(**overrides):
    values = {
        "sid": PHONE_SID,
        "phone_number": PHONE_NUMBER,
        "voice_url": "https://previous.example.test/voice",
        "voice_method": "GET",
        "status_callback": None,
        "status_callback_method": "POST",
        "trunk_sid": None,
        "voice_application_sid": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


@pytest.fixture
def command_environment(monkeypatch, tmp_path):
    backup_path = tmp_path / ".twilio-local-demo-backup.json"
    archive_dir = tmp_path / ".twilio-local-demo-backups"
    monkeypatch.setattr(twilio_local_demo, "DEFAULT_BACKUP_PATH", backup_path)
    monkeypatch.setattr(twilio_local_demo, "DEFAULT_ARCHIVE_DIR", archive_dir)
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", ACCOUNT_SID)
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", AUTH_TOKEN)
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", PHONE_NUMBER)
    return backup_path


def _backup_payload(*, account_sid=ACCOUNT_SID):
    return {
        "version": 1,
        "created_at": "2026-07-29T12:00:00+00:00",
        "account_sid": account_sid,
        "phone_sid": PHONE_SID,
        "phone_number": PHONE_NUMBER,
        "original_configuration": {
            "voice_url": "https://previous.example.test/voice",
            "voice_method": "GET",
            "status_callback": None,
            "status_callback_method": "POST",
        },
        "demo_configuration": {
            "voice_url": f"{BASE_URL}/api/voice/twilio/incoming/",
            "voice_method": "POST",
            "status_callback": f"{BASE_URL}/api/voice/twilio/status/",
            "status_callback_method": "POST",
        },
    }


def test_configure_writes_secret_free_backup_and_verified_webhooks(
    command_environment,
):
    resource = _resource()
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        call_command(
            "twilio_local_demo",
            "configure",
            "--base-url",
            f"{BASE_URL}/",
            stdout=StringIO(),
        )

    expected = {
        "voice_url": f"{BASE_URL}/api/voice/twilio/incoming/",
        "voice_method": "POST",
        "status_callback": f"{BASE_URL}/api/voice/twilio/status/",
        "status_callback_method": "POST",
    }
    assert incoming.list_calls == [{"phone_number": PHONE_NUMBER, "limit": 2}]
    assert incoming.update_calls == [expected]
    assert {
        field: getattr(resource, field) for field in expected
    } == expected

    backup_text = command_environment.read_text(encoding="utf-8")
    backup = json.loads(backup_text)
    assert AUTH_TOKEN not in backup_text
    assert "auth_token" not in backup
    assert backup["phone_sid"] == PHONE_SID
    assert backup["original_configuration"] == {
        "voice_url": "https://previous.example.test/voice",
        "voice_method": "GET",
        "status_callback": None,
        "status_callback_method": "POST",
    }


def test_preflight_authenticates_and_discovers_without_modifying_anything(
    command_environment,
):
    resource = _resource()
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        call_command(
            "twilio_local_demo",
            "preflight",
            stdout=StringIO(),
        )

    assert incoming.list_calls == [{"phone_number": PHONE_NUMBER, "limit": 2}]
    assert incoming.update_calls == []
    assert not command_environment.exists()


def test_restore_reapplies_exact_backup_and_removes_it(command_environment):
    original = {
        "voice_url": "https://previous.example.test/voice",
        "voice_method": "GET",
        "status_callback": None,
        "status_callback_method": "POST",
    }
    demo = {
        "voice_url": f"{BASE_URL}/api/voice/twilio/incoming/",
        "voice_method": "POST",
        "status_callback": f"{BASE_URL}/api/voice/twilio/status/",
        "status_callback_method": "POST",
    }
    command_environment.write_text(
        json.dumps(
            {
                "version": 1,
                "created_at": "2026-07-29T12:00:00+00:00",
                "account_sid": ACCOUNT_SID,
                "phone_sid": PHONE_SID,
                "phone_number": PHONE_NUMBER,
                "original_configuration": original,
                "demo_configuration": demo,
            }
        ),
        encoding="utf-8",
    )
    resource = _resource(**demo)
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        call_command(
            "twilio_local_demo",
            "restore",
            stdout=StringIO(),
        )

    assert incoming.update_calls == [
        {
            "voice_url": original["voice_url"],
            "voice_method": original["voice_method"],
            "status_callback": "",
            "status_callback_method": original["status_callback_method"],
        }
    ]
    assert resource.voice_url == original["voice_url"]
    assert resource.voice_method == original["voice_method"]
    assert resource.status_callback is None
    assert resource.status_callback_method == original["status_callback_method"]
    assert not command_environment.exists()


def test_restore_removes_backup_without_update_when_already_original(
    command_environment,
):
    command_environment.write_text(
        json.dumps(_backup_payload()),
        encoding="utf-8",
    )
    resource = _resource()
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        call_command(
            "twilio_local_demo",
            "restore",
            stdout=StringIO(),
        )

    assert incoming.update_calls == []
    assert not command_environment.exists()


def test_restore_refuses_to_overwrite_configuration_drift(
    command_environment,
):
    command_environment.write_text(
        json.dumps(_backup_payload()),
        encoding="utf-8",
    )
    resource = _resource(
        voice_url="https://manually-changed.example.test/voice",
        voice_method="POST",
    )
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        with pytest.raises(CommandError, match="cambió después"):
            call_command(
                "twilio_local_demo",
                "restore",
                stdout=StringIO(),
            )

    assert incoming.update_calls == []
    assert command_environment.exists()


def test_restore_accepts_backup_file_from_archive_directory(
    command_environment,
):
    archive_dir = twilio_local_demo.DEFAULT_ARCHIVE_DIR
    archive_dir.mkdir()
    archive_path = archive_dir / "twilio-backup-archived.json"
    payload = _backup_payload()
    archive_path.write_text(json.dumps(payload), encoding="utf-8")
    resource = _resource(**payload["demo_configuration"])
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        call_command(
            "twilio_local_demo",
            "restore",
            "--backup-file",
            str(archive_path),
            stdout=StringIO(),
        )

    assert len(incoming.update_calls) == 1
    assert not archive_path.exists()
    assert not command_environment.exists()


def test_restore_rejects_backup_file_outside_archive_directory(
    command_environment,
):
    outside_path = command_environment.parent / "outside-backup.json"
    outside_path.write_text(json.dumps(_backup_payload()), encoding="utf-8")

    with patch.object(twilio_local_demo, "Client"):
        with pytest.raises(CommandError, match="hijo directo"):
            call_command(
                "twilio_local_demo",
                "restore",
                "--backup-file",
                str(outside_path),
                stdout=StringIO(),
            )

    assert outside_path.exists()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("trunk_sid", "TK" + ("3" * 32), "SIP Trunk"),
        ("voice_application_sid", "AP" + ("4" * 32), "TwiML App"),
    ],
)
def test_configure_refuses_managed_voice_routes_without_backup(
    command_environment,
    field,
    value,
    message,
):
    resource = _resource(**{field: value})
    incoming = FakeIncomingPhoneNumbers(resource)
    client = SimpleNamespace(incoming_phone_numbers=incoming)

    with patch.object(twilio_local_demo, "Client", return_value=client):
        with pytest.raises(CommandError, match=message):
            call_command(
                "twilio_local_demo",
                "configure",
                "--base-url",
                BASE_URL,
                stdout=StringIO(),
            )

    assert incoming.update_calls == []
    assert not command_environment.exists()


def test_archive_preserves_other_account_backup_without_calling_twilio(
    command_environment,
    monkeypatch,
):
    payload = _backup_payload(account_sid=ACCOUNT_SID)
    command_environment.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", OTHER_ACCOUNT_SID)

    with patch.object(twilio_local_demo, "Client") as client_factory:
        call_command(
            "twilio_local_demo",
            "archive-other-account-backup",
            stdout=StringIO(),
        )

    client_factory.assert_not_called()
    assert not command_environment.exists()
    archives = list(twilio_local_demo.DEFAULT_ARCHIVE_DIR.glob("*.json"))
    assert len(archives) == 1
    assert json.loads(archives[0].read_text(encoding="utf-8")) == payload
    assert AUTH_TOKEN not in archives[0].read_text(encoding="utf-8")


def test_archive_refuses_backup_from_current_account(
    command_environment,
):
    payload = _backup_payload(account_sid=ACCOUNT_SID)
    command_environment.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(CommandError, match="cuenta actual"):
        call_command(
            "twilio_local_demo",
            "archive-other-account-backup",
            stdout=StringIO(),
        )

    assert json.loads(command_environment.read_text(encoding="utf-8")) == payload
    assert not twilio_local_demo.DEFAULT_ARCHIVE_DIR.exists()
