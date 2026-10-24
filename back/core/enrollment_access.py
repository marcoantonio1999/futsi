"""Explicit enrollment-only site grants; malformed grants fail closed."""
PREFIX = 'player_enrollments_site:'


def enrollment_site_ids(user):
    grants = [value[len(PREFIX):] for value in (user.section_permissions or [])
              if isinstance(value, str) and value.startswith(PREFIX)]
    if not grants:
        return None  # Preserve existing global/own-link operator behavior.
    return {int(value) for value in grants if value.isascii() and value.isdigit() and 0 < int(value) < 2 ** 63}
