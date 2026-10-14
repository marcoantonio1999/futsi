import unicodedata
from datetime import date
from hashlib import sha256
from django.db import connection
from rest_framework.exceptions import ValidationError

def identity_key(name, birth_date):
    if isinstance(birth_date,str): birth_date=date.fromisoformat(birth_date)
    normalized = ''.join(char for char in unicodedata.normalize('NFKD',name) if not unicodedata.combining(char))
    normalized = ' '.join(normalized.casefold().split())
    return sha256(f'{normalized}|{birth_date.isoformat()}'.encode()).hexdigest()

def lock_identity(key):
    if not connection.in_atomic_block:
        raise RuntimeError('La comprobación final de identidad requiere una transacción.')
    if connection.vendor == 'postgresql':
        number = int(key[:16],16)
        if number >= 2**63: number -= 2**64
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s)',[number])

def assert_not_blacklisted(name, birth_date, *, locked=False):
    from core.enrollment_models import PlayerBlacklistEntry
    key = identity_key(name,birth_date)
    if locked: lock_identity(key)
    if PlayerBlacklistEntry.objects.filter(identity_key=key,is_active=True).exists():
        # Never expose disciplinary details on a public enrollment link.
        raise ValidationError({'detail':'No se puede completar esta inscripción. Comunícate con la administración.'})
    return key

def assert_player_id_not_blacklisted(player_id):
    from core.enrollment_models import PlayerBlacklistEntry
    if PlayerBlacklistEntry.objects.filter(source_player_id=player_id,is_active=True).exists():
        raise ValidationError({'player':'Este jugador tiene una exclusión activa en todas las sedes.'})
