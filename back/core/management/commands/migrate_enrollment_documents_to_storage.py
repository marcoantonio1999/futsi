from hashlib import sha256
from django.core.management.base import BaseCommand, CommandError
from core.enrollment_models import PlayerEnrollmentDocument
from core.services import enrollment_storage


class Command(BaseCommand):
    help = "Traslada documentos existentes a Storage privado, verificando SHA-256 antes de liberar la copia de la base."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        rows = PlayerEnrollmentDocument.objects.filter(storage_path="")
        self.stdout.write(f"Documentos pendientes: {rows.count()}")
        if not options["apply"]:
            return
        enrollment_storage.ensure_private_bucket()
        for doc in rows.iterator(chunk_size=1):
            content = bytes(doc.content)
            if not content or sha256(content).hexdigest() != doc.sha256:
                raise CommandError(f"Integridad inválida en documento {doc.pk}; se conserva en base.")
            path = f"inscripciones/{doc.enrollment_id}/historicos/{doc.pk}/{doc.sha256}"
            enrollment_storage.upload_document(path, content, doc.content_type)
            enrollment_storage.verify_document(path, doc.sha256)
            changed = PlayerEnrollmentDocument.objects.filter(pk=doc.pk, storage_path="", sha256=doc.sha256).update(storage_path=path, content=b"")
            self.stdout.write(f"Documento {doc.pk}: {'trasladado y verificado' if changed else 'ya actualizado'}")
