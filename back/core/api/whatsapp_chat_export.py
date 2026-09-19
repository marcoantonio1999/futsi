from collections import defaultdict
from io import BytesIO

from django.utils import timezone
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill


EXCEL_CELL_LIMIT = 32_767
HEADER_FILL = PatternFill("solid", fgColor="285943")
HEADER_FONT = Font(color="FFFFFF", bold=True)


def _safe_text(value) -> str:
    text = ILLEGAL_CHARACTERS_RE.sub("", str(value or ""))[:EXCEL_CELL_LIMIT]
    if text.startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def _contact_name(conversation) -> str:
    context = conversation.context if isinstance(conversation.context, dict) else {}
    return (
        str(context.get("contact_name") or "").strip()
        or (
            str(conversation.booking.responsible_name or "").strip()
            if conversation.booking_id and conversation.booking
            else ""
        )
        or "Contacto de WhatsApp"
    )


def _local_excel_datetime(value):
    if not value:
        return None
    return timezone.localtime(value).replace(tzinfo=None)


def _prepare_sheet(sheet, headers, widths):
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:{sheet.cell(row=1, column=len(headers)).column_letter}1"
    sheet.sheet_view.showGridLines = False
    for column, (header, width) in enumerate(zip(headers, widths), start=1):
        cell = sheet.cell(row=1, column=column, value=header)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        sheet.column_dimensions[cell.column_letter].width = width
    sheet.row_dimensions[1].height = 24


def build_whatsapp_chat_export(conversations):
    grouped = defaultdict(lambda: {
        "label": "",
        "site": "",
        "name": "",
        "conversation_ids": [],
        "messages": [],
    })
    conversation_count = 0
    for conversation in conversations:
        conversation_count += 1
        key = (conversation.to_address, conversation.contact_phone)
        row = grouped[key]
        row["label"] = row["label"] or str(getattr(conversation, "channel_label", "") or "")
        row["site"] = row["site"] or str(getattr(conversation, "channel_site_name", "") or "")
        candidate_name = _contact_name(conversation)
        if not row["name"] or row["name"] == "Contacto de WhatsApp":
            row["name"] = candidate_name
        row["conversation_ids"].append(conversation.pk)
        row["messages"].extend(list(conversation.messages.all()))

    workbook = Workbook()
    summary = workbook.active
    summary.title = "Conversaciones"
    summary_headers = [
        "Número de atención",
        "Identificador de atención",
        "Sede",
        "Número de contacto",
        "Nombre del contacto",
        "Conversaciones",
        "Mensajes recibidos",
        "Mensajes enviados",
        "Primera interacción",
        "Última interacción",
    ]
    _prepare_sheet(summary, summary_headers, [24, 29, 22, 20, 32, 15, 19, 18, 21, 21])

    detail = workbook.create_sheet("Mensajes")
    detail_headers = [
        "Número de atención",
        "Identificador de atención",
        "Número de contacto",
        "Nombre del contacto",
        "Fecha y hora",
        "Dirección",
        "Mensaje",
        "Estado",
    ]
    _prepare_sheet(detail, detail_headers, [24, 29, 20, 32, 21, 14, 78, 14])

    total_messages = 0
    ordered_groups = sorted(
        grouped.items(),
        key=lambda item: (
            item[1]["label"].casefold(),
            item[1]["name"].casefold(),
            item[0][1],
        ),
    )
    for (business_address, contact_phone), row in ordered_groups:
        messages = sorted(row["messages"], key=lambda message: (message.created_at, message.pk))
        received = sum(message.direction == "inbound" for message in messages)
        sent = sum(message.direction == "outbound" for message in messages)
        total_messages += len(messages)
        channel_label = row["label"] or business_address
        summary.append([
            _safe_text(channel_label),
            _safe_text(business_address),
            _safe_text(row["site"]),
            _safe_text(contact_phone),
            _safe_text(row["name"]),
            len(row["conversation_ids"]),
            received,
            sent,
            _local_excel_datetime(messages[0].created_at) if messages else None,
            _local_excel_datetime(messages[-1].created_at) if messages else None,
        ])
        for message in messages:
            revoked = str(message.body or "").strip().casefold() in {"[revoke]", "mensaje eliminado"}
            detail.append([
                _safe_text(channel_label),
                _safe_text(business_address),
                _safe_text(contact_phone),
                _safe_text(row["name"]),
                _local_excel_datetime(message.created_at),
                "Recibido" if message.direction == "inbound" else "Enviado",
                "Mensaje eliminado" if revoked else _safe_text(message.body),
                "Eliminado" if revoked else "Visible",
            ])

    for sheet in (summary, detail):
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=cell.column in (5, 7))
        for date_column in ((9, 10) if sheet is summary else (5,)):
            for cell in sheet.iter_cols(min_col=date_column, max_col=date_column, min_row=2):
                for value in cell:
                    value.number_format = "dd/mm/yyyy hh:mm"

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue(), {
        "contacts": len(grouped),
        "conversations": conversation_count,
        "messages": total_messages,
    }
