"""Explicit, resumable migration. Keeps every original; no cron or automatic backfill."""
import json
from hashlib import sha256
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from core.enrollment_models import PlayerEnrollmentDocument, PlayerBlacklistEntry, PlayerSanction
from core.services import enrollment_storage, enrollment_r2


class Command(BaseCommand):
    help = 'Copia archivos privados de Inscripciones a R2, verifica SHA-256 y cambia solo las referencias verificadas.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--backup-path')

    def handle(self, *args, **options):
        sources = []
        specs = [(PlayerEnrollmentDocument,'storage_path','sha256','content','content_type'),
                 (PlayerBlacklistEntry,'photo_storage_path','photo_sha256','photo_content','photo_content_type'),
                 (PlayerSanction,'appeal_letter_path','appeal_letter_sha256',None,None)]
        for model, path_field, hash_field, content_field, mime_field in specs:
            for row in model.objects.all().iterator(chunk_size=100):
                path = getattr(row,path_field)
                if path.startswith(enrollment_r2.PREFIX): continue
                content = bytes(getattr(row,content_field)) if content_field else b''
                if not path and not content: continue
                digest = getattr(row,hash_field)
                sources.append((model,row.pk,path_field,hash_field,path,digest,content,getattr(row,mime_field) if mime_field else 'image/jpeg'))
        summary = {'pending_references':len(sources),'apply':options['apply'],'originals_deleted':0}
        if not options['apply']:
            self.stdout.write(json.dumps(summary));return
        if not options['backup_path']:
            raise CommandError('Indica --backup-path privado para conservar las referencias anteriores.')
        backup = Path(options['backup_path'])
        if backup.exists():raise CommandError('El respaldo ya existe; no se sobrescribe.')
        backup.write_text(json.dumps([{'model':m._meta.label,'id':pk,'field':f,'path':p,'sha256':h} for m,pk,f,hf,p,h,c,mime in sources]),encoding='utf-8')
        enrollment_r2.config()
        verified = {}; migrated = 0; failures = []; transferred = 0
        for model,pk,path_field,hash_field,path,digest,content,mime in sources:
            try:
                if not digest:raise ValueError('missing_hash')
                identity = (path,digest)
                destination = verified.get(identity)
                if destination is None:
                    content = enrollment_storage.read_document(path) if path else content
                    if sha256(content).hexdigest()!=digest:raise ValueError('source_integrity')
                    destination = enrollment_r2.reference(f'migrados/{digest}')
                    try: existing=enrollment_r2.request(destination)
                    except RuntimeError: existing=None
                    if existing is None:
                        enrollment_r2.upload(destination,content,mime);transferred+=len(content)
                        existing=enrollment_r2.request(destination)
                    if sha256(existing).hexdigest()!=digest:raise ValueError('destination_integrity')
                    verified[identity]=destination
                with transaction.atomic():
                    row=model.objects.select_for_update().get(pk=pk)
                    if getattr(row,path_field)!=path or getattr(row,hash_field)!=digest:raise ValueError('reference_changed')
                    setattr(row,path_field,destination);row.save(update_fields=[path_field])
                migrated+=1
            except Exception as error:
                # No file contents, signed URLs, credentials or personal fields.
                failures.append({'model':model._meta.label,'id':pk,'error':type(error).__name__})
        self.stdout.write(json.dumps({**summary,'migrated_references':migrated,'uploaded_bytes':transferred,'failures':failures}))
