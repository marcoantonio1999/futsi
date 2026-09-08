from django.core.management.base import BaseCommand
from django.db import transaction
from core.models import AuditLog
from core.services.student_deletion import cleanup_files


class Command(BaseCommand):
    help = "Reintenta archivos pendientes de eliminaciones de alumnos, tutores y torneos ya confirmadas."

    def handle(self, *args, **options):
        audits = AuditLog.objects.filter(action__in=["student_deleted", "guardian_deleted", "tournament_deleted"]).exclude(metadata__pending_files=[])
        for audit_id in audits.values_list("pk", flat=True).iterator():
            with transaction.atomic():
                audit = AuditLog.objects.select_for_update().get(pk=audit_id)
                result = cleanup_files(audit)
                self.stdout.write(f"Eliminación {audit_id}: {result['cleanup_pending']} archivos pendientes")
