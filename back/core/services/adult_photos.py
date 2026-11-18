"""Private adult portraits in the existing R2 store; no permanent public URLs."""
from pathlib import Path
import tempfile
from . import enrollment_r2


def reference(player):
    uri = getattr(player, 'photo_url', '') or ''
    if not uri.startswith(enrollment_r2.PREFIX):
        return None
    try:
        team = getattr(player, 'team', None)
        site_id = team.tournament.site_id if team else None
        key = enrollment_r2.object_key(uri)
        if site_id and key.startswith(f'adults/{site_id}/'):
            return uri
    except (AttributeError, ValueError, RuntimeError):
        pass
    return None


def display_url(player):
    uri = reference(player)
    return enrollment_r2.signed_url(uri, expires=900) if uri else ''


def download_reference(player):
    uri = reference(player)
    if not uri:
        return None
    # Fetch before creating the file: a failed request must not leave a temp file.
    data = enrollment_r2.request(uri)
    suffix = Path(enrollment_r2.object_key(uri)).suffix.lower()
    if suffix not in {'.png', '.jpg', '.jpeg', '.webp'}:
        raise ValueError('Formato de foto privada no permitido.')
    with tempfile.NamedTemporaryFile(prefix='futsi-adult-', suffix=suffix, delete=False) as handle:
        handle.write(data)
        return handle.name
