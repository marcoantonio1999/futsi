"""Conservative CV contact extraction. No filenames, fuzzy names, OCR or AI."""
import hashlib
import re
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.db.models import Q
from core.exam_identity import exam_email, exam_phone
from core.exam_profiles import normalized

STOP_HEADINGS={'experiencia','experiencia laboral','experiencia profesional','historial laboral',
               'referencias','referencias personales','referencias laborales','educacion',
               'formacion academica','formacion profesional','trayectoria profesional'}


def cv_digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def cv_contacts(text):
    header=[]
    for line in text[:4000].splitlines()[:40]:
        heading=re.sub(r'[^a-z0-9 ]','',normalized(line)).strip()
        if heading in STOP_HEADINGS:
            break
        header.append(line)
    body='\n'.join(header)
    emails=set()
    for value in re.findall(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",body):
        try: validate_email(value)
        except ValidationError: continue
        emails.add(exam_email(value))
    phones=set()
    for line in header:
        if re.search(r'\b(curp|rfc|nss|cedula|sueldo|salario|matricula|identificacion)\b',normalized(line)):
            continue
        for match in re.finditer(r'(?<![\w])\+?\d[\d ()\-.]{7,24}\d(?![\w])',line):
            value=match.group().strip()
            digits=exam_phone(value)
            if len(digits)==10 or (value.startswith('+') and 8<=len(digits)<=15):
                phones.add(digits)
    return sorted(emails),sorted(phones)


def match_cv(rows,text):
    emails,phones=cv_contacts(text)
    if not emails and not phones:
        return 'unmatched',rows.none()
    condition=Q(pk__in=[])
    if emails: condition|=Q(identity_email__in=emails)
    if phones: condition|=Q(identity_phone__in=phones)
    matches=rows.filter(condition)
    if len(emails)>1 or len(phones)>1:
        return 'ambiguous_contacts',matches
    if emails and phones and matches.exists() and not matches.filter(identity_email=emails[0],identity_phone=phones[0]).exists():
        return 'conflict',matches
    candidates=list(matches[:2])
    if len(candidates)!=1:
        return ('ambiguous' if candidates else 'unmatched'),matches
    candidate=candidates[0]
    if (emails and candidate.identity_email!=emails[0]) or (phones and candidate.identity_phone!=phones[0]):
        return 'conflict',matches
    return 'matched',matches
