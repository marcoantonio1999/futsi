"""Private academy portraits: upload before committing the student record."""
import logging
import tempfile
from pathlib import Path
from uuid import uuid4

from django.db import transaction
from PIL import Image, ImageOps
from rest_framework.exceptions import APIException, ValidationError

from .supabase_storage import upload_private_file, delete_private_file

PHOTO_BUCKET = "student-private-photos"
MAX_PHOTO_BYTES = 5 * 1024 * 1024
logger = logging.getLogger(__name__)


class StudentPhotoUnavailable(APIException):
    status_code = 503
    default_detail = "No se pudo guardar la foto. Los datos del alumno no se guardaron; vuelve a intentarlo."


def validate_student_photo(photo):
    if photo.size > MAX_PHOTO_BYTES:
        raise ValidationError("La foto debe pesar como máximo 5 MB.")
    image = getattr(photo, "image", None)
    if image is None or image.format not in {"JPEG", "PNG", "WEBP"}:
        raise ValidationError("Selecciona una imagen JPG, PNG o WebP.")
    if image.width * image.height > 25_000_000:
        raise ValidationError("La foto debe tener como máximo 25 megapíxeles.")
    return photo


def save_student(serializer):
    photo = serializer.validated_data.pop("photo", None)
    if not photo:
        return serializer.save()
    object_path = f"academy/{uuid4().hex}.jpg"
    try:
        with tempfile.TemporaryDirectory(prefix="futsi-portrait-") as directory:
            path = Path(directory) / "portrait.jpg"
            photo.seek(0)
            with Image.open(photo) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1600, 1600))
                image.save(path, format="JPEG", quality=88)
            uri = upload_private_file(PHOTO_BUCKET, object_path, path, upsert=False)
    except Exception as exc:
        # Do not expose storage credentials or provider response bodies to clients.
        logger.warning("Student photo upload failed: %s", type(exc).__name__)
        raise StudentPhotoUnavailable() from exc
    try:
        with transaction.atomic():
            # Clear a legacy local reference so FaceGuard uses the new portrait.
            return serializer.save(photo="", photo_url=uri)
    except Exception:
        try:
            delete_private_file(PHOTO_BUCKET, object_path)
        except Exception:
            logger.warning("Could not clean up unassigned student portrait %s", object_path)
        raise
