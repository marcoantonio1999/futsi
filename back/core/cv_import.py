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


def cv_lines(text, *, extended=False):
    header=[]
    for line in [line for line in text[:(12000 if extended else 4000)].splitlines() if line.strip()][:240 if extended else 40]:
        heading=re.sub(r'[^a-z0-9 ]','',normalized(line)).strip()
        if heading in STOP_HEADINGS and (not extended or heading.startswith('referencias')):
            break
        header.append(line)
    return header


def cv_contacts(text, *, extended=False):
    header = cv_lines(text, extended=extended)
    body='\n'.join(header)
    # PDF text runs often add spaces on either side of the email separator.
    body=re.sub(r'(?<=[A-Za-z0-9_])[ \t]*@[ \t]*(?=[A-Za-z0-9])', '@', body)
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
    primary_emails, primary_phones = emails, phones
    # PDF columns may serialize experience before the applicant's contact block.
    # Broader reading is gated by the exact registered name AND a contact match.
    extended_emails, extended_phones = cv_contacts(text, extended=True)
    if (extended_emails, extended_phones) != (emails, phones):
        broader = rows.filter(Q(identity_email__in=extended_emails) | Q(identity_phone__in=extended_phones))
        name_body = ' ' + re.sub(r'[^\w]+', ' ', normalized(' '.join(cv_lines(text, extended=True)))).strip() + ' '
        verified = []
        for candidate in broader:
            name = re.sub(r'[^\w]+', ' ', normalized(candidate.name)).strip()
            if len(name.split()) >= 3 and (' ' + name + ' ') in name_body:
                verified.append(candidate.pk)
        if len(verified) == 1:
            candidate = rows.get(pk=verified[0])
            # Keep actual disagreements for manual review, including extra contacts.
            if (not extended_emails or extended_emails == [candidate.identity_email]) and (not extended_phones or extended_phones == [candidate.identity_phone]):
                return 'matched', rows.filter(pk=candidate.pk)
        elif len(verified) > 1:
            return 'ambiguous', rows.filter(pk__in=verified)
    emails, phones = primary_emails, primary_phones
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
