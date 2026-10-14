"""Private, bounded thumbnails; only photos, never identity documents or signatures."""
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
from PIL import Image, ImageOps
from django.core.files.storage import default_storage
from core.enrollment_models import PlayerEnrollmentDocument
from . import enrollment_storage


def snapshot_photo(sanction):
    document = PlayerEnrollmentDocument.objects.filter(enrollment_id=sanction.enrollment_id, kind='player_photo').first() if sanction.enrollment_id else None
    if document:
        return {'photo_storage_path': document.storage_path, 'photo_content_type': document.content_type,
                'photo_sha256': document.sha256, 'photo_content': bytes(document.content) if not document.storage_path else b''}
    if sanction.player_id and sanction.player.photo:
        return {'photo_legacy_file': sanction.player.photo.name}
    return {}


def thumbnail(content):
    if not content or len(content)>enrollment_storage.MAX_BYTES:
        raise ValueError('Foto inválida.')
    with Image.open(BytesIO(content)) as image:
        if image.format not in {'PNG','JPEG','WEBP'} or image.width*image.height>25_000_000:
            raise ValueError('Foto inválida.')
        image.draft('RGB',(192,192))
        image.thumbnail((192,192))
        image=ImageOps.exif_transpose(image)
        output=BytesIO()
        image.convert('RGB').save(output,format='JPEG',quality=82,optimize=True)
        return output.getvalue()


@lru_cache(maxsize=128)
def stored_thumbnail(path,digest):
    # Cache only the small derived photo. Original files are not retained in memory.
    content=enrollment_storage.read_document(path)
    if sha256(content).hexdigest()!=digest: raise ValueError('Foto inválida.')
    return thumbnail(content)


def document_thumbnail(document):
    if document.storage_path:return stored_thumbnail(document.storage_path,document.sha256)
    content=bytes(document.content)
    if sha256(content).hexdigest()!=document.sha256:raise ValueError('Foto inválida.')
    return thumbnail(content)


def legacy_thumbnail(name):
    with default_storage.open(name,'rb') as file:
        return thumbnail(file.read(enrollment_storage.MAX_BYTES+1))
