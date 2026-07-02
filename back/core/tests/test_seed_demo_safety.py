import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


def test_seed_demo_reset_requires_explicit_destructive_flag(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "true")
    monkeypatch.setenv("FUTSI_ENV", "test")
    monkeypatch.delenv("ALLOW_DESTRUCTIVE_SEED", raising=False)

    with pytest.raises(CommandError, match="ALLOW_DESTRUCTIVE_SEED"):
        call_command("seed_demo", "--reset", verbosity=0)


def test_seed_demo_is_blocked_in_production(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "false")
    monkeypatch.setenv("FUTSI_ENV", "production")
    monkeypatch.setenv("ALLOW_DESTRUCTIVE_SEED", "true")

    with pytest.raises(CommandError, match="FUTSI_ENV=production"):
        call_command("seed_demo", verbosity=0)


def test_seed_demo_is_blocked_when_debug_false_outside_demo_or_staging(monkeypatch):
    monkeypatch.setenv("DJANGO_DEBUG", "false")
    monkeypatch.setenv("FUTSI_ENV", "local")
    monkeypatch.setenv("ALLOW_DESTRUCTIVE_SEED", "true")

    with pytest.raises(CommandError, match="DJANGO_DEBUG=false"):
        call_command("seed_demo", verbosity=0)
