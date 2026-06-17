from __future__ import annotations

import csv
import re
import unicodedata
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Guardian, Site, Student
from core.services.supabase_storage import upload_private_file


def normalize_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip().casefold()


def safe_path_part(value: str) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-zA-Z0-9._-]+", "_", text).strip("_")
    return text or "student"


class Command(BaseCommand):
    help = "Sube fotos de alumnos a un bucket privado de Supabase Storage y guarda referencias supabase:// en students.photo_url."

    def add_arguments(self, parser):
        parser.add_argument("--manifest", required=True, help="CSV con columnas student_id,nombre,image_path,categoria.")
        parser.add_argument("--site-id", type=int, required=True, help="Sede donde se crean o actualizan los alumnos.")
        parser.add_argument("--bucket", default="student-private-photos")
        parser.add_argument("--group-name", default="", help="Grupo que se asigna al crear alumnos faltantes.")
        parser.add_argument("--guardian-name", default="Importacion fotos privadas", help="Representante placeholder para alumnos creados.")
        parser.add_argument("--create-missing", action="store_true", help="Crea alumnos que no existan por nombre normalizado en la sede.")
        parser.add_argument("--apply", action="store_true", help="Ejecuta cambios reales. Sin esto solo reporta.")

    def handle(self, *args, **options):
        manifest = Path(options["manifest"])
        if not manifest.exists():
            raise CommandError(f"No existe manifest: {manifest}")
        site = Site.objects.get(id=options["site_id"])
        bucket = options["bucket"]
        apply_changes = options["apply"]
        create_missing = options["create_missing"]

        students_by_name = {
            normalize_name(student.full_name): student
            for student in Student.objects.filter(site=site)
        }

        rows = []
        with manifest.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                rows.append(row)

        created = 0
        updated = 0
        uploaded = 0
        skipped = []

        guardian = None
        if apply_changes and create_missing:
            guardian, _ = Guardian.objects.get_or_create(
                full_name=options["guardian_name"],
                defaults={"notes": "Representante placeholder para importacion privada de fotos."},
            )

        with transaction.atomic():
            for row in rows:
                name = (row.get("nombre") or row.get("name") or "").strip()
                external_id = (row.get("student_id") or "").strip()
                image_path = Path((row.get("image_path") or "").strip())
                if not name or not image_path.exists():
                    skipped.append(f"{name or external_id}: sin nombre o imagen")
                    continue

                student = students_by_name.get(normalize_name(name))
                if not student and create_missing:
                    if not apply_changes:
                        created += 1
                        updated += 1
                        continue
                    else:
                        student = Student.objects.create(
                            site=site,
                            guardian=guardian,
                            full_name=name,
                            category=(row.get("categoria") or "").strip(),
                            group_name=options["group_name"],
                            status="active",
                        )
                        students_by_name[normalize_name(name)] = student
                        created += 1
                if not student:
                    skipped.append(f"{name}: no existe en sede {site.name}")
                    continue

                object_path = f"students/{student.id}/{safe_path_part(external_id or str(student.id))}_{safe_path_part(name)}{image_path.suffix.lower() or '.jpg'}"
                private_uri = f"supabase://{bucket}/{object_path}"
                if apply_changes:
                    private_uri = upload_private_file(bucket, object_path, image_path, upsert=True)
                    uploaded += 1
                    student.photo_url = private_uri
                    if row.get("categoria") and not student.category:
                        student.category = row["categoria"].strip()
                    student.save(update_fields=["photo_url", "category", "updated_at"])
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"{'Aplicado' if apply_changes else 'Dry-run'}: {updated} alumnos vinculados, {created} creados, {uploaded} fotos subidas, {len(skipped)} omitidos."
            )
        )
        for item in skipped[:20]:
            self.stdout.write(f"omitido: {item}")
        if len(skipped) > 20:
            self.stdout.write(f"... {len(skipped) - 20} omitidos mas")
