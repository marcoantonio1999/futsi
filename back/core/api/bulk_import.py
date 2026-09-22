"""Bounded, read-only recipient import. Workbooks/formulas are never executed."""
import csv
import io
import json
import re
import unicodedata
import zipfile
from datetime import date, datetime

from openpyxl import load_workbook

MAX_BYTES = 10 * 1024 * 1024
MAX_TEXT_ROWS = 1000
MAX_FILE_ROWS = 10000
MAX_COLUMNS = 50
MAX_HEADER_ROWS = 25

PHONE_HEADERS = {'telefono', 'telefonos', 'celular', 'numero', 'numeros', 'numero de contacto', 'whatsapp', 'phone'}
NAME_HEADERS = {'nombre', 'nombre completo', 'nombre del contacto', 'name', 'contact name', 'contacto'}
CONTACT_NAME_HEADERS = {'contacto', 'nombre del contacto', 'contact name'}
FILTER_COLUMNS = {
    'campaign_status': {'estatus campana', 'estado campana'},
    'mutual_interaction': {'hubo interaccion de ambos lados', 'interaccion de ambos lados'},
    'pending_response': {'pendiente de nuestra respuesta', 'pendiente de respuesta'},
    'academy_relationship': {'relacion academia', 'relacion con academia'},
    'league_relevance': {'relevancia para liga', 'relevancia liga'},
    'age_bucket': {'antiguedad de la ultima interaccion', 'antiguedad ultima interaccion'},
    'started_by': {'inicio la conversacion', 'quien inicio la conversacion'},
    'last_period': {'periodo de ultima interaccion', 'mes de ultima interaccion'},
    'last_interaction': {'ultima interaccion', 'fecha de ultima interaccion'},
    'team_responded': {'nuestro equipo respondio', 'academia respondio', 'liga respondio'},
    'no_contact': {'no contactar'},
    'platform': {'plataforma', 'plataforma de origen', 'origen', 'fuente', 'bolsa de trabajo', 'portal', 'platform', 'source'},
    'vacancy_type': {'tipo de vacante', 'vacante', 'puesto', 'cargo', 'tipo de puesto', 'perfil', 'vacancy type', 'job type'},
}


def _header(value):
    text = ''.join(
        char for char in unicodedata.normalize('NFKD', str(value or '').lower())
        if not unicodedata.combining(char)
    )
    return re.sub(r'\s+', ' ', text).strip(' \t\r\n¿?¡!')


def _clean(value, limit=160):
    if value is None or isinstance(value, bool):
        return ''
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    text = ' '.join(str(value).split())
    if text.lstrip().startswith('='):
        return ''
    return text[:limit]


def _period(value):
    if isinstance(value, (datetime, date)):
        return f'{value.year:04d}-{value.month:02d}'
    text = _clean(value, 40)
    match = re.search(r'(?<!\d)((?:19|20)\d{2})[-/]?(0[1-9]|1[0-2])(?!\d)', text)
    return f'{match.group(1)}-{match.group(2)}' if match else ''


def normalize_phone(value):
    if isinstance(value, bool):
        raise ValueError()
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError()
        value = int(value)
    text = re.sub(r'[\s()\-]', '', str(value).strip())
    if not re.fullmatch(r'[1-9][0-9]{9}', text):
        raise ValueError()
    return text


def _normalize_file_phone(value):
    """Accept the Mexican country prefixes emitted by WhatsApp exports."""
    try:
        return normalize_phone(value)
    except ValueError:
        if isinstance(value, bool):
            raise
        if isinstance(value, float):
            if not value.is_integer():
                raise
            value = int(value)
        text = str(value).strip()
        if text.startswith("'"):
            text = text[1:].strip()
        text = re.sub(r'[\s()+\-]', '', text)
        if re.fullmatch(r'52[1-9][0-9]{9}', text):
            return text[2:]
        if re.fullmatch(r'521[1-9][0-9]{9}', text):
            return text[3:]
        raise ValueError()


def _profile(metadata_columns):
    if 'league_relevance' in metadata_columns:
        return 'league'
    if 'academy_relationship' in metadata_columns:
        return 'academy'
    return 'generic'


def _facets(contacts):
    keys = (
        'campaign_status', 'mutual_interaction', 'pending_response',
        'academy_relationship', 'league_relevance', 'age_bucket', 'started_by',
        'year', 'month', 'team_responded',
    )
    return {
        key: sorted({contact.get(key, '') for contact in contacts if contact.get(key, '')}, key=str.casefold)
        for key in keys
    }


def review(values, names=None, metadata=None, parameter_values=None, max_rows=MAX_TEXT_ROWS, allow_country_code=False):
    values = [(index, value) for index, value in values if value is not None and str(value).strip()]
    if len(values) > max_rows:
        if max_rows == MAX_TEXT_ROWS:
            raise ValueError('Carga hasta 1,000 números por lote.')
        raise ValueError('El archivo puede contener hasta 10,000 contactos.')
    valid, invalid, seen, duplicates = [], [], set(), 0
    names = names or {}
    metadata = metadata or {}
    parameter_values = parameter_values or {}
    kept_names = {}
    kept_metadata = {}
    kept_parameters = {}
    for index, value in values:
        try:
            phone = (_normalize_file_phone if allow_country_code else normalize_phone)(value)
        except ValueError:
            invalid.append({'row': index, 'value': str(value)[:80], 'reason': 'Usa exactamente 10 dígitos de México, sin código de país.'})
            continue
        if phone in seen:
            duplicates += 1
        else:
            seen.add(phone)
            valid.append(phone)
        name = _clean(names.get(index), 120)
        if name and phone not in kept_names:
            kept_names[phone] = name
        row_metadata = metadata.get(index, {})
        if row_metadata:
            target = kept_metadata.setdefault(phone, {})
            for key, raw_value in row_metadata.items():
                value_text = _clean(raw_value)
                if value_text and not target.get(key):
                    target[key] = value_text
        row_parameters = parameter_values.get(index, {})
        if row_parameters:
            target = kept_parameters.setdefault(phone, {})
            for key, raw_value in row_parameters.items():
                value_text = _clean(raw_value, 500)
                if value_text and not target.get(key):
                    target[key] = value_text

    contacts = []
    metadata_columns = set()
    for phone in valid:
        fields = kept_metadata.get(phone, {})
        metadata_columns.update(fields)
        last_period = _period(fields.get('last_period')) or _period(fields.get('last_interaction'))
        contact = {
            'phone': phone,
            'name': kept_names.get(phone, ''),
            **{key: fields.get(key, '') for key in FILTER_COLUMNS if key not in {'last_period', 'last_interaction', 'no_contact', 'platform', 'vacancy_type'}},
            'period': last_period,
            'year': last_period[:4] if last_period else '',
            'month': last_period[5:7] if len(last_period) >= 7 else '',
        }
        if fields.get('no_contact') and _header(fields['no_contact']) in {'si', 'true', '1'}:
            contact['campaign_status'] = 'No contactar'
        contacts.append(contact)

    result = {
        'phones': valid,
        'names': kept_names,
        'filters': {
            phone: {key: value for key in ('platform', 'vacancy_type') if (value := kept_metadata.get(phone, {}).get(key))}
            for phone in valid
            if any(kept_metadata.get(phone, {}).get(key) for key in ('platform', 'vacancy_type'))
        },
        'parameter_values': {phone: kept_parameters.get(phone, {}) for phone in valid},
        'invalid': invalid,
        'duplicates': duplicates,
        'count': len(valid),
    }
    analysis_columns = metadata_columns - {'platform', 'vacancy_type'}
    if analysis_columns:
        result.update({
            'file_contacts': contacts,
            'file_profile': _profile(metadata_columns),
            'file_facets': _facets(contacts),
            'file_total': len(contacts),
        })
    return result


def _find_columns(header_row):
    normalized = [_header(value) for value in header_row]
    phone_columns = [index for index, value in enumerate(normalized) if value in PHONE_HEADERS]
    name_columns = [index for index, value in enumerate(normalized) if value in NAME_HEADERS]
    name_columns.sort(key=lambda index: normalized[index] not in CONTACT_NAME_HEADERS)
    metadata_columns = {}
    for key, aliases in FILTER_COLUMNS.items():
        match = next((index for index, value in enumerate(normalized) if value in aliases), None)
        if match is not None:
            metadata_columns[key] = match
    return phone_columns, name_columns, metadata_columns


def _template_parameters(raw):
    if raw in (None, ''):
        return []
    try:
        values = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        raise ValueError('Los campos de la plantilla no tienen un formato válido.') from None
    if not isinstance(values, list) or len(values) > 20:
        raise ValueError('La plantilla contiene demasiados campos.')
    result = []
    for item in values:
        if not isinstance(item, dict):
            raise ValueError('Los campos de la plantilla no tienen un formato válido.')
        key = str(item.get('key') or '').strip()
        label = str(item.get('label') or '').strip()
        if not key or len(key) > 80 or not label or len(label) > 120:
            raise ValueError('Los campos de la plantilla no tienen un formato válido.')
        result.append({'key': key, 'label': label, 'contact_name': item.get('contact_name') is True})
    if len({item['key'] for item in result}) != len(result):
        raise ValueError('La plantilla contiene campos duplicados.')
    return result


def _parameter_columns(header_row, parameters):
    normalized = [_header(value) for value in header_row]
    result = {}
    for parameter in parameters:
        aliases = {_header(parameter['label'])}
        if parameter['contact_name']:
            aliases.update(NAME_HEADERS)
        match = next((index for index, value in enumerate(normalized) if value in aliases), None)
        if match is not None:
            result[parameter['key']] = match
    return result


def _xlsx_rows(content):
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(entry.file_size for entry in archive.infolist()) > 50 * 1024 * 1024 or len(archive.infolist()) > 500:
                raise ValueError('El Excel es demasiado grande al descomprimirlo.')
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=False, keep_links=False)
        try:
            # Python's sort is stable, so a sheet literally named "Contactos" goes
            # first and the workbook order is preserved for every other sheet.
            sheets = sorted(workbook.worksheets, key=lambda sheet: _header(sheet.title) != 'contactos')
            fallback = None
            for sheet in sheets:
                preview = [list(row) for row in sheet.iter_rows(max_row=MAX_HEADER_ROWS, max_col=MAX_COLUMNS, values_only=True)]
                if fallback is None:
                    fallback = (sheet, preview, 0)
                for row_index, row in enumerate(preview):
                    phone_columns, _, _ = _find_columns(row)
                    if phone_columns:
                        rows = [list(r) for r in sheet.iter_rows(
                            min_row=row_index + 1,
                            max_row=row_index + MAX_FILE_ROWS + 2,
                            max_col=MAX_COLUMNS,
                            values_only=True,
                        )]
                        return rows, 0
            if fallback:
                sheet, preview, row_index = fallback
                rows = preview + [list(r) for r in sheet.iter_rows(
                    min_row=len(preview) + 1,
                    max_row=MAX_FILE_ROWS + MAX_HEADER_ROWS + 2,
                    max_col=MAX_COLUMNS,
                    values_only=True,
                )]
                return rows, row_index
            return [], 0
        finally:
            workbook.close()
    except (zipfile.BadZipFile, KeyError, OSError):
        raise ValueError('El archivo no es un Excel .xlsx válido.') from None


def _tabular_rows(content, extension):
    try:
        decoded = content.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise ValueError('Guarda el archivo como UTF-8.') from None
    if extension == 'txt':
        return None, decoded
    try:
        dialect = csv.Sniffer().sniff(decoded[:4096], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    rows = []
    try:
        for row in csv.reader(io.StringIO(decoded), dialect):
            if any(str(value).strip() for value in row):
                rows.append(row)
                if len(rows) > MAX_FILE_ROWS + MAX_HEADER_ROWS:
                    raise ValueError('El archivo puede contener hasta 10,000 contactos.')
    except csv.Error:
        raise ValueError('El CSV no tiene un formato válido.') from None
    return rows, None


def import_recipients(file=None, text='', column=None, template_parameters=None):
    parameters = _template_parameters(template_parameters)
    if file and text:
        raise ValueError('Elige archivo o texto, no ambos a la vez.')
    if not file:
        if not isinstance(text, str) or len(text) > MAX_BYTES:
            raise ValueError('Texto inválido o demasiado grande.')
        return review(list(enumerate(re.split(r'[,;\r\n]+', text), 1)))
    if file.size > MAX_BYTES:
        raise ValueError('El archivo puede pesar hasta 10 MB.')
    content = file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('El archivo puede pesar hasta 10 MB.')
    extension = file.name.lower().rsplit('.', 1)[-1]
    if extension == 'xlsx':
        rows, detected_header_index = _xlsx_rows(content)
    elif extension in {'csv', 'txt'}:
        rows, txt = _tabular_rows(content, extension)
        if txt is not None:
            return review(list(enumerate(re.split(r'[,;\r\n]+', txt), 1)))
        detected_header_index = 0
    else:
        raise ValueError('Selecciona .xlsx, .csv o .txt. Para .xls, guárdalo primero como .xlsx.')

    rows = [row for row in (rows or []) if any(value is not None and str(value).strip() for value in row)]
    if not rows:
        return review([])

    header_index = min(detected_header_index, len(rows) - 1)
    phone_columns, name_columns, metadata_columns = _find_columns(rows[header_index])
    parameter_columns = _parameter_columns(rows[header_index], parameters)
    chosen = int(column) if column not in (None, '') else phone_columns[0] if len(phone_columns) == 1 else None
    if chosen is None and max(map(len, rows)) > 1:
        return {
            **review([]),
            'needs_column': True,
            'columns': [
                {'index': index, 'label': str(value or f'Columna {index + 1}')[:80]}
                for index, value in enumerate(rows[header_index][:MAX_COLUMNS])
            ],
        }
    chosen = chosen or 0
    if chosen < 0 or chosen >= len(rows[header_index]):
        raise ValueError('Selecciona una columna de teléfonos válida.')

    has_header = chosen in phone_columns
    if column not in (None, '') and not has_header:
        try:
            normalize_phone(rows[header_index][chosen])
        except ValueError:
            has_header = True
    data_start = header_index + 1 if has_header else header_index
    available_name_columns = name_columns if has_header else []
    names = {
        row_number: next(
            (row[index] for index in available_name_columns if index < len(row) and _clean(row[index], 120)),
            '',
        )
        for row_number, row in enumerate(rows[data_start:], data_start + 1)
        if available_name_columns
    }
    metadata = {
        row_number: {
            key: row[index] for key, index in metadata_columns.items() if index < len(row)
        }
        for row_number, row in enumerate(rows[data_start:], data_start + 1)
    }
    parameter_values = {
        row_number: {
            key: row[index] for key, index in parameter_columns.items() if index < len(row)
        }
        for row_number, row in enumerate(rows[data_start:], data_start + 1)
    }
    values = [
        (row_number, row[chosen] if chosen < len(row) else None)
        for row_number, row in enumerate(rows[data_start:], data_start + 1)
    ]
    return review(values, names, metadata, parameter_values, max_rows=MAX_FILE_ROWS, allow_country_code=True)
