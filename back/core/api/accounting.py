from collections import defaultdict

from .common import *
from django.conf import settings

def money_value(value):
    return float(value or 0)


def write_sheet(workbook, title, headers, rows):
    sheet = workbook.create_sheet(title[:31])
    header_fill = PatternFill("solid", fgColor="111827")
    column_widths = [len(str(header or "")) for header in headers]
    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(row=1, column=column, value=header)
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    for row_index, row in enumerate(rows, start=2):
        for column, value in enumerate(row, start=1):
            sheet.cell(row=row_index, column=column, value=value)
            value_length = len(str(value or ""))
            if value_length > column_widths[column - 1]:
                column_widths[column - 1] = value_length
    for column, width in enumerate(column_widths, start=1):
        sheet.column_dimensions[sheet.cell(row=1, column=column).column_letter].width = min(max(width + 2, 12), 42)
    return sheet


class AccountingExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role not in {"admin", "owner", "accounting"}:
            return Response({"detail": "No tienes permiso para exportar reportes contables."}, status=status.HTTP_403_FORBIDDEN)

        sites = list(Site.objects.only("id", "name"))
        charges = list(
            Charge.objects.select_related("site", "student", "team").only(
                "id",
                "site",
                "student",
                "team",
                "concept",
                "description",
                "amount",
                "due_date",
                "status",
                "site__id",
                "site__name",
                "student__id",
                "student__full_name",
                "team__id",
                "team__name",
            )
        )
        payments = list(
            Payment.objects.select_related("site", "charge", "student", "team", "received_by").only(
                "id",
                "site",
                "charge",
                "student",
                "team",
                "method",
                "channel",
                "status",
                "amount",
                "paid_at",
                "confirmed_at",
                "reference",
                "tracking_key",
                "site__id",
                "site__name",
                "charge__id",
                "charge__concept",
                "charge__site",
                "student__id",
                "student__full_name",
                "team__id",
                "team__name",
                "received_by__id",
                "received_by__username",
            )
        )
        expenses = list(
            Expense.objects.select_related("site", "captured_by", "approved_by").only(
                "id",
                "site",
                "category",
                "description",
                "provider_name",
                "amount",
                "expense_date",
                "status",
                "site__id",
                "site__name",
                "captured_by__id",
                "captured_by__username",
                "approved_by__id",
                "approved_by__username",
            )
        )
        discounts = list(
            Discount.objects.select_related("charge", "student", "team", "requested_by", "approved_by").only(
                "id",
                "charge",
                "student",
                "team",
                "reason",
                "amount",
                "status",
                "charge__id",
                "charge__concept",
                "student__id",
                "student__full_name",
                "team__id",
                "team__name",
                "requested_by__id",
                "requested_by__username",
                "approved_by__id",
                "approved_by__username",
            )
        )
        attendance_records = list(AttendanceRecord.objects.select_related("student", "session").all())
        invoices = list(
            Invoice.objects.only(
                "id",
                "uuid",
                "kind",
                "recipient_name",
                "recipient_tax_id",
                "concept",
                "subtotal",
                "tax",
                "total",
                "issued_at",
            )
        )

        confirmed_statuses = {"registered", "reconciled"}
        workbook = Workbook()
        workbook.remove(workbook.active)

        charge_count_by_site = defaultdict(int)
        charge_site_by_id = {}
        open_balance_by_site = defaultdict(float)
        for charge in charges:
            charge_count_by_site[charge.site_id] += 1
            charge_site_by_id[charge.id] = charge.site_id
            if charge.status in {"pending", "partial"}:
                open_balance_by_site[charge.site_id] += money_value(charge.amount)

        income_by_site = defaultdict(float)
        for payment in payments:
            if payment.status in confirmed_statuses and payment.charge_id in charge_site_by_id:
                income_by_site[charge_site_by_id[payment.charge_id]] += money_value(payment.amount)

        approved_expenses_by_site = defaultdict(float)
        pending_expenses_by_site = defaultdict(float)
        for expense in expenses:
            if expense.status == "approved":
                approved_expenses_by_site[expense.site_id] += money_value(expense.amount)
            elif expense.status == "pending":
                pending_expenses_by_site[expense.site_id] += money_value(expense.amount)

        summary_rows = []
        for site in sites:
            income = income_by_site[site.id]
            approved_expenses = approved_expenses_by_site[site.id]
            pending_expenses = pending_expenses_by_site[site.id]
            open_balance = open_balance_by_site[site.id]
            summary_rows.append([site.name, income, approved_expenses, income - approved_expenses, pending_expenses, open_balance, charge_count_by_site[site.id]])

        write_sheet(workbook, "Resumen", ["Sede", "Ingresos", "Egresos aprobados", "Utilidad", "Egresos pendientes", "Cargos abiertos", "Cargos"], summary_rows)
        write_sheet(
            workbook,
            "Pagos",
            ["ID", "Sede", "Cliente", "Concepto", "Metodo", "Canal", "Estado", "Monto", "Pagado", "Confirmado", "Recibio", "Referencia"],
            [
                [
                    payment.id,
                    payment.site.name if payment.site else "",
                    payment.student.full_name if payment.student else payment.team.name if payment.team else "",
                    payment.charge.concept if payment.charge else "",
                    payment.get_method_display(),
                    payment.get_channel_display() if payment.channel else "",
                    payment.get_status_display(),
                    money_value(payment.amount),
                    payment.paid_at.isoformat() if payment.paid_at else "",
                    payment.confirmed_at.isoformat() if payment.confirmed_at else "",
                    payment.received_by.username if payment.received_by else "",
                    payment.reference or payment.tracking_key,
                ]
                for payment in payments
            ],
        )
        write_sheet(
            workbook,
            "Cargos",
            ["ID", "Sede", "Cliente", "Concepto", "Descripcion", "Monto", "Vencimiento", "Estado"],
            [
                [
                    charge.id,
                    charge.site.name if charge.site else "",
                    charge.student.full_name if charge.student else charge.team.name if charge.team else "",
                    charge.concept,
                    charge.description,
                    money_value(charge.amount),
                    charge.due_date.isoformat() if charge.due_date else "",
                    charge.get_status_display(),
                ]
                for charge in charges
            ],
        )
        write_sheet(
            workbook,
            "Gastos",
            ["ID", "Sede", "Categoria", "Descripcion", "Proveedor", "Monto", "Fecha", "Estado", "Capturo", "Aprobo"],
            [
                [
                    expense.id,
                    expense.site.name if expense.site else "",
                    expense.category,
                    expense.description,
                    expense.provider_name,
                    money_value(expense.amount),
                    expense.expense_date.isoformat() if expense.expense_date else "",
                    expense.get_status_display(),
                    expense.captured_by.username if expense.captured_by else "",
                    expense.approved_by.username if expense.approved_by else "",
                ]
                for expense in expenses
            ],
        )
        write_sheet(
            workbook,
            "Descuentos",
            ["ID", "Cliente", "Cargo", "Motivo", "Monto", "Estado", "Solicito", "Aprobo"],
            [
                [
                    discount.id,
                    discount.student.full_name if discount.student else discount.team.name if discount.team else "",
                    discount.charge.concept if discount.charge else "",
                    discount.reason,
                    money_value(discount.amount),
                    discount.get_status_display(),
                    discount.requested_by.username if discount.requested_by else "",
                    discount.approved_by.username if discount.approved_by else "",
                ]
                for discount in discounts
            ],
        )
        write_sheet(
            workbook,
            "Asistencia con adeudo",
            ["ID", "Alumno", "Sesion", "Estado", "Adeudo al capturar", "Motivo"],
            [
                [
                    record.id,
                    record.student.full_name if record.student else "",
                    f"{record.session.date} {record.session.group_name}" if record.session else "",
                    record.get_status_display(),
                    "Si" if record.had_debt_at_capture else "No",
                    record.override_reason,
                ]
                for record in attendance_records
                if record.had_debt_at_capture
            ],
        )
        write_sheet(
            workbook,
            "Facturas",
            ["ID", "UUID", "Tipo", "Receptor", "RFC", "Concepto", "Subtotal", "IVA", "Total", "Fecha"],
            [
                [
                    invoice.id,
                    str(invoice.uuid),
                    invoice.get_kind_display(),
                    invoice.recipient_name,
                    invoice.recipient_tax_id,
                    invoice.concept,
                    money_value(invoice.subtotal),
                    money_value(invoice.tax),
                    money_value(invoice.total),
                    invoice.issued_at.isoformat() if invoice.issued_at else "",
                ]
                for invoice in invoices
            ],
        )

        buffer = BytesIO()
        workbook.save(buffer)
        buffer.seek(0)
        payload = buffer.getvalue()
        if len(payload) > settings.FILE_EXPORT_MAX_EXCEL_BYTES:
            return Response({"detail": "Reporte excede el tamano permitido."}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        filename = f"reporte-contable-futsi-{timezone.localdate().isoformat()}.xlsx"
        response = HttpResponse(
            payload,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["X-Content-Type-Options"] = "nosniff"
        return response

