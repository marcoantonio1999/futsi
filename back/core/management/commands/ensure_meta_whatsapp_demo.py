from datetime import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.models import Court, Site, TrialAvailabilityRule


class Command(BaseCommand):
    help = "Prepara disponibilidad local idempotente para el demo de WhatsApp Meta."

    def handle(self, *args, **options):
        if not settings.DEBUG or str(getattr(settings, "FUTSI_ENV", "")).lower() == "production":
            raise CommandError("Este comando sólo puede usarse en el demo local.")

        code = str(settings.META_WHATSAPP_DEFAULT_SITE_CODE or "cuajimalpa").strip()
        site, _ = Site.objects.update_or_create(
            code=code,
            defaults={
                "name": settings.META_WHATSAPP_LOCATION_NAME,
                "address": settings.META_WHATSAPP_LOCATION_ADDRESS,
                "latitude": settings.META_WHATSAPP_LOCATION_LATITUDE,
                "longitude": settings.META_WHATSAPP_LOCATION_LONGITUDE,
                "is_active": True,
            },
        )
        court = Court.objects.filter(
            site=site,
            name__in=("Cancha Power Soccer Academy", "Cancha Colegio Franco Inglés"),
        ).order_by("id").first()
        if court:
            court.name = "Cancha Power Soccer Academy"
            court.is_active = True
            court.save(update_fields=["name", "is_active", "updated_at"])
        else:
            court = Court.objects.create(
                site=site,
                name="Cancha Power Soccer Academy",
                is_active=True,
            )
        for weekday in (0, 2):
            TrialAvailabilityRule.objects.update_or_create(
                site=site,
                court=court,
                weekday=weekday,
                starts_at=time(17, 0),
                defaults={
                    "ends_at": time(19, 0),
                    "slot_minutes": 60,
                    "capacity": 4,
                    "is_active": True,
                },
            )
        self.stdout.write(
            self.style.SUCCESS(
                "Demo WhatsApp listo: Power Soccer Academy con horarios lunes y miércoles."
            )
        )
