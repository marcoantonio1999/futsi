"""Bounded, read-only import. Workbooks/formulas are never executed."""
import csv
import io
import re
import unicodedata
import zipfile
from openpyxl import load_workbook

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000

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

def review(values, names=None):
    values = [(i, v) for i, v in values if v is not None and str(v).strip()]
    if len(values) > MAX_ROWS:
        raise ValueError('Carga hasta 1,000 números por lote.')
    valid, invalid, seen, duplicates = [], [], set(), 0
    for index, value in values:
        try:
            phone = normalize_phone(value)
        except ValueError:
            invalid.append({'row': index, 'value': str(value)[:80], 'reason': 'Usa exactamente 10 dígitos de México, sin código de país.'})
            continue
        if phone in seen:
            duplicates += 1
        else:
            seen.add(phone)
            valid.append(phone)
    names = names or {}
    # Only keep names associated with accepted numbers. Never evaluate formulas.
    kept_names = {}
    for index, value in values:
        try:
            phone = normalize_phone(value)
        except ValueError:
            continue
        name = names.get(index)
        if isinstance(name, str) and not name.lstrip().startswith('='):
            name = ' '.join(name.split())[:120]
            if name and phone not in kept_names:
                kept_names[phone] = name
    return {'phones': valid, 'names': kept_names, 'invalid': invalid, 'duplicates': duplicates, 'count': len(valid)}

def import_recipients(file=None, text='', column=None):
    if file and text:
        raise ValueError('Elige archivo o texto, no ambos a la vez.')
    if not file:
        if not isinstance(text, str) or len(text) > MAX_BYTES:
            raise ValueError('Texto inválido o demasiado grande.')
        return review(list(enumerate(re.split(r'[,;\r\n]+', text), 1)))
    if file.size > MAX_BYTES:
        raise ValueError('El archivo puede pesar hasta 2 MB.')
    content = file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('El archivo puede pesar hasta 2 MB.')
    extension = file.name.lower().rsplit('.', 1)[-1]
    if extension == 'xlsx':
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(z.file_size for z in archive.infolist()) > 20 * 1024 * 1024 or len(archive.infolist()) > 500:
                    raise ValueError('El Excel es demasiado grande al descomprimirlo.')
            workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=False, keep_links=False)
            try:
                sheet = workbook.active
                if sheet.max_row and sheet.max_row > MAX_ROWS + 1:
                    raise ValueError('Usa una hoja de hasta 1,000 teléfonos y un encabezado; elimina filas vacías sobrantes.')
                if sheet.max_column and sheet.max_column > 50:
                    raise ValueError('Usa un Excel con un máximo de 50 columnas.')
                rows = [list(r) for r in sheet.iter_rows(max_row=MAX_ROWS + 2, max_col=min(sheet.max_column or 50, 50), values_only=True)]
            finally:
                workbook.close()
        except (zipfile.BadZipFile, KeyError, OSError):
            raise ValueError('El archivo no es un Excel .xlsx válido.') from None
    elif extension in {'csv', 'txt'}:
        try:
            decoded = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise ValueError('Guarda el archivo como UTF-8.') from None
        if extension == 'txt':
            return review(list(enumerate(re.split(r'[,;\r\n]+', decoded), 1)))
        try:
            dialect = csv.Sniffer().sniff(decoded[:4096], delimiters=',;\t')
        except csv.Error:
            dialect = csv.excel
        rows = []
        for row in csv.reader(io.StringIO(decoded), dialect):
            if any(str(v).strip() for v in row):
                rows.append(row)
                if len(rows) > MAX_ROWS + 1:
                    raise ValueError('Carga hasta 1,000 números por lote.')
    else:
        raise ValueError('Selecciona .xlsx, .csv o .txt. Para .xls, guárdalo primero como .xlsx.')
    rows = [row for row in rows if any(v is not None and str(v).strip() for v in row)]
    if not rows:
        return review([])
    def header(v):
        return ''.join(c for c in unicodedata.normalize('NFKD', str(v or '').lower()) if not unicodedata.combining(c)).strip()
    candidates = [i for i, v in enumerate(rows[0]) if header(v) in {'telefono', 'telefonos', 'celular', 'numero', 'numeros', 'whatsapp', 'phone'}]
    chosen = int(column) if column not in (None, '') else candidates[0] if len(candidates) == 1 else None
    if chosen is None and max(map(len, rows)) > 1:
        return {'needs_column': True, 'columns': [{'index': i, 'label': str(v or f'Columna {i+1}')[:80]} for i, v in enumerate(rows[0][:50])]}
    chosen = chosen or 0
    if chosen < 0 or chosen >= len(rows[0]):
        raise ValueError('Selecciona una columna de teléfonos válida.')
    has_header = chosen in candidates
    if column not in (None, '') and not has_header:
        try:
            normalize_phone(rows[0][chosen])
        except ValueError:
            has_header = True
    name_columns = [i for i, v in enumerate(rows[0]) if i != chosen and header(v) in {'nombre', 'nombre completo', 'name', 'contact name'}]
    name_column = name_columns[0] if has_header and len(name_columns) == 1 else None
    names = {i+1: row[name_column] for i, row in enumerate(rows) if i > 0 and name_column is not None and name_column < len(row)}
    return review([(i+1, row[chosen] if chosen < len(row) else None) for i, row in enumerate(rows) if not (i == 0 and has_header)], names)
