from .common import *

HISTORICAL_IMPORT_ROLES = {"admin", "owner", "dev", "accounting"}


def normalize_label(value):
    text = str(value or "").strip().lower()
    text = "".join(char for char in unicodedata.normalize("NFD", text) if unicodedata.category(char) != "Mn")
    return " ".join(text.replace(".", " ").replace("-", " ").replace("_", " ").split())


MONTHS_ES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}


def parse_decimal(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float, Decimal)):
        amount = Decimal(str(value))
    else:
        cleaned = str(value).replace("$", "").replace(",", "").strip()
        if not cleaned:
            return None
        try:
            amount = Decimal(cleaned)
        except Exception:
            return None
    if amount == 0:
        return None
    return amount.quantize(Decimal("0.01"))


def match_site(raw_name, sites):
    normalized = normalize_label(raw_name)
    if not normalized:
        return None
    aliases = {
        "aca bosques": "Roma",
        "lga bosques": "Roma",
        "aca sporting": "Coyoacan",
        "aca irlandes": "Santa Fe",
    }
    alias = aliases.get(normalized)
    if alias:
        return next((site for site in sites if normalize_label(site.name) == normalize_label(alias)), None)
    for site in sites:
        site_label = normalize_label(site.name)
        if site_label and (site_label in normalized or normalized in site_label):
            return site
    return None


def month_from_label(value):
    normalized = normalize_label(value)
    return MONTHS_ES.get(normalized.split()[0]) if normalized else None


def parse_historical_discrepancy_rows(workbook):
    sheet = next((name for name in workbook.sheetnames if "verificacion" in normalize_label(name) and "adeudos" in normalize_label(name)), None)
    if not sheet:
        return []

    worksheet = workbook[sheet]
    site_name = str(worksheet.cell(row=1, column=1).value or "Sede historica").strip()
    sites = list(Site.objects.all())
    site = match_site(site_name, sites)
    ticket_average = parse_decimal(worksheet.cell(row=7, column=4).value) or Decimal("0")
    current_year = timezone.localdate().year

    month_blocks = []
    for col in range(1, worksheet.max_column + 1):
        month = month_from_label(worksheet.cell(row=10, column=col).value)
        if month:
            month_blocks.append({"month": month, "month_label": str(worksheet.cell(row=10, column=col).value).strip(), "start_col": col})

    parsed_rows = []
    current_section = ""
    for row_index in range(12, worksheet.max_row + 1):
        marker = normalize_label(worksheet.cell(row=row_index, column=1).value)
        if marker in {"sin pago", "con pago incompleto"}:
            current_section = marker
            continue

        student_name = str(worksheet.cell(row=row_index, column=3).value or "").strip()
        if not student_name or not current_section:
            continue

        category = str(worksheet.cell(row=row_index, column=2).value or "").strip()
        guardian_name = str(worksheet.cell(row=row_index, column=4).value or "").strip()
        phone = str(worksheet.cell(row=row_index, column=5).value or "").strip()
        observations = str(worksheet.cell(row=row_index, column=27).value or "").strip()
        row_payments = [
            parse_decimal(worksheet.cell(row=row_index, column=block["start_col"] + 2).value) or Decimal("0")
            for block in month_blocks
        ]
        row_expected = max([ticket_average, *row_payments, Decimal("0")])

        for block in month_blocks:
            classes = worksheet.cell(row=row_index, column=block["start_col"]).value
            folio = worksheet.cell(row=row_index, column=block["start_col"] + 1).value
            amount = parse_decimal(worksheet.cell(row=row_index, column=block["start_col"] + 2).value) or Decimal("0")
            try:
                classes_count = int(classes or 0)
            except Exception:
                classes_count = 0
            if classes_count <= 0:
                continue

            folio_text = str(folio or "").strip()
            is_missing_folio = not folio_text
            is_missing_payment = amount <= 0
            is_partial = current_section == "con pago incompleto" or (row_expected > 0 and amount > 0 and amount < row_expected)
            if not (is_missing_folio or is_missing_payment or is_partial):
                continue

            if is_missing_payment and is_missing_folio:
                discrepancy_type = "no_payment_no_folio"
                severity = "high"
            elif is_missing_payment:
                discrepancy_type = "no_payment_reported"
                severity = "high"
            elif is_missing_folio:
                discrepancy_type = "missing_folio"
                severity = "medium"
            else:
                discrepancy_type = "partial_payment"
                severity = "medium"

            _, last_day = monthrange(current_year, block["month"])
            expected_amount = row_expected if row_expected > 0 else ticket_average
            parsed_rows.append(
                {
                    "row_type": "discrepancy",
                    "sheet_name": sheet,
                    "source_row": row_index,
                    "month_label": block["month_label"],
                    "site": site,
                    "site_name_raw": site_name,
                    "concept_code": "ADEUDO",
                    "concept": f"{student_name} - {block['month_label']} - {discrepancy_type}",
                    "amount": expected_amount - amount if expected_amount > amount else amount,
                    "record_date": date(current_year, block["month"], last_day),
                    "raw_data": {
                        "sheet": sheet,
                        "excel_row": row_index,
                        "site_header": site_name,
                        "section": current_section,
                        "student_name": student_name,
                        "category": category,
                        "guardian_name": guardian_name,
                        "phone": phone,
                        "classes_attended": classes_count,
                        "folio": folio_text,
                        "paid_amount": str(amount),
                        "expected_amount": str(expected_amount),
                        "estimated_missing_amount": str(expected_amount - amount if expected_amount > amount else Decimal("0")),
                        "discrepancy_type": discrepancy_type,
                        "severity": severity,
                        "observations": observations,
                    },
                }
            )
    return parsed_rows


def load_historical_workbook(file_obj, password=None):
    file_obj.seek(0)
    if password:
        try:
            import msoffcrypto

            office_file = msoffcrypto.OfficeFile(file_obj)
            if office_file.is_encrypted():
                decrypted = BytesIO()
                office_file.load_key(password=password)
                office_file.decrypt(decrypted)
                decrypted.seek(0)
                return load_workbook(decrypted, data_only=True, read_only=True), True
        except ImportError as exc:
            raise ValueError("El archivo parece requerir password, pero falta instalar msoffcrypto-tool en el backend.") from exc
        except Exception as exc:
            raise ValueError("No se pudo abrir el Excel cifrado con esa password. Verifica la password e intenta otra vez.") from exc
        finally:
            file_obj.seek(0)

    try:
        return load_workbook(file_obj, data_only=True, read_only=True), False
    except Exception as exc:
        if password:
            raise ValueError("No se pudo abrir el archivo con esa password.") from exc
        raise ValueError("No se pudo abrir el Excel. Si tiene password o cifrado, capturala e intenta otra vez.") from exc


def parse_historical_workbook(file_obj, password=None):
    workbook, password_used = load_historical_workbook(file_obj, password=password)

    current_year = timezone.localdate().year
    sites = list(Site.objects.all())
    parsed_rows = []
    sheets = [("INGRESOS SEDES", "income"), ("GASTOS SEDES", "expense")]

    for sheet_name, row_type in sheets:
        if sheet_name not in workbook.sheetnames:
            continue
        worksheet = workbook[sheet_name]
        month = None
        site_headers = {}
        for row_index, row in enumerate(worksheet.iter_rows(values_only=True), start=1):
            first_cell_month = month_from_label(row[0] if row else None)
            if first_cell_month:
                month = first_cell_month
                site_headers = {
                    column_index: str(value).strip()
                    for column_index, value in enumerate(row, start=1)
                    if column_index >= 4 and value not in (None, "")
                }
            if row_index < 3 or not month:
                continue
            concept_code = str(row[1] or "").strip() if len(row) > 1 else ""
            concept = str(row[2] or row[0] or row[1] or "").strip() if len(row) > 2 else ""
            if not concept or normalize_label(concept) in {"concepto", "total", "totales"}:
                continue
            _, last_day = monthrange(current_year, month)
            record_date = date(current_year, month, last_day)
            for column_index in range(3, min(len(row), worksheet.max_column)):
                amount = parse_decimal(row[column_index])
                if amount is None:
                    continue
                site_raw = site_headers.get(column_index + 1, "")
                if normalize_label(site_raw) in {"", "total"}:
                    continue
                site = match_site(site_raw, sites)
                parsed_rows.append(
                    {
                        "row_type": row_type,
                        "sheet_name": sheet_name,
                        "source_row": row_index,
                        "month_label": str(worksheet.cell(row=row_index, column=1).value or worksheet.cell(row=1, column=1).value or ""),
                        "site": site,
                        "site_name_raw": str(site_raw).strip(),
                        "concept_code": concept_code,
                        "concept": concept,
                        "amount": amount,
                        "record_date": record_date,
                        "raw_data": {
                            "sheet": sheet_name,
                            "excel_row": row_index,
                            "excel_column": column_index + 1,
                            "site_header": str(site_raw),
                            "month": month,
                                "password_used": password_used,
                            },
                        }
                    )
    discrepancy_rows = parse_historical_discrepancy_rows(workbook)
    for row in discrepancy_rows:
        row["raw_data"] = {**row["raw_data"], "password_used": password_used}
    parsed_rows.extend(discrepancy_rows)
    if not parsed_rows:
        raise ValueError("No se encontraron filas importables en INGRESOS SEDES, GASTOS SEDES o Lista Verificacion Adeudos.")
    return parsed_rows


