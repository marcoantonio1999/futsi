"""Deterministic contact matching for one exam, not identity verification."""
import re
import unicodedata


def exam_email(value):
    return unicodedata.normalize('NFC', value.strip()).casefold()


def exam_phone(value):
    digits = re.sub(r'[^0-9]', '', value)
    # Mexican local, international +52 and legacy mobile +521 are equivalent.
    if len(digits) == 12 and digits.startswith('52'):
        return digits[2:]
    if len(digits) == 13 and digits.startswith('521'):
        return digits[3:]
    return digits
