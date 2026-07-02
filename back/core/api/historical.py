from django.conf import settings

from .common import *
from core.file_security import EXCEL_EXTENSIONS, EXCEL_MIME_TYPES, FileSecurityError, validate_upload
from .historical_parser import HISTORICAL_IMPORT_ROLES, parse_historical_workbook

class HistoricalImportViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = HistoricalImport.objects.select_related("uploaded_by", "committed_by").prefetch_related("rows", "rows__site").annotate(row_count=Count("rows")).all()
    serializer_class = HistoricalImportSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if self.request.user.role not in HISTORICAL_IMPORT_ROLES:
            return HistoricalImport.objects.none()
        return super().get_queryset().order_by("-created_at")

    @action(detail=False, methods=["post"], url_path="preview")
    def preview(self, request):
        if request.user.role not in HISTORICAL_IMPORT_ROLES:
            return Response({"detail": "Solo admin o contador pueden cargar historicos."}, status=status.HTTP_403_FORBIDDEN)
        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "Debes adjuntar un archivo Excel."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_upload(
                upload,
                allowed_extensions=EXCEL_EXTENSIONS,
                allowed_mime_types=EXCEL_MIME_TYPES,
                max_bytes=settings.FILE_UPLOAD_MAX_EXCEL_BYTES,
            )
        except FileSecurityError as exc:
            return Response({"detail": exc.detail}, status=exc.status_code)

        password = request.data.get("password", "")
        try:
            parsed_rows = parse_historical_workbook(upload, password=password)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        upload.seek(0)
        historical_import = HistoricalImport.objects.create(
            original_file=upload,
            original_filename=upload.name,
            uploaded_by=request.user,
            source_password_used=bool(password),
            notes=request.data.get("notes", ""),
            summary={
                "rows_detected": len(parsed_rows),
                "income": str(sum(row["amount"] for row in parsed_rows if row["row_type"] == "income")),
                "expense": str(sum(row["amount"] for row in parsed_rows if row["row_type"] == "expense")),
                "discrepancies": len([row for row in parsed_rows if row["row_type"] == "discrepancy"]),
            },
        )
        rows = [
            HistoricalImportRow(
                historical_import=historical_import,
                row_type=row["row_type"],
                sheet_name=row["sheet_name"],
                source_row=row["source_row"],
                month_label=row["month_label"],
                site=row["site"],
                site_name_raw=row["site_name_raw"],
                concept_code=row["concept_code"],
                concept=row["concept"],
                amount=row["amount"],
                record_date=row["record_date"],
                raw_data=row["raw_data"],
            )
            for row in parsed_rows[:500]
        ]
        HistoricalImportRow.objects.bulk_create(rows)
        AuditLog.objects.create(
            actor=request.user,
            action="historical_import_preview",
            table_name="historical_imports",
            record_id=str(historical_import.id),
            new_values=historical_import.summary,
            metadata={"filename": upload.name, "password_used": bool(password)},
        )
        historical_import = self.get_queryset().get(id=historical_import.id)
        return Response(self.get_serializer(historical_import).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        historical_import = self.get_object()
        if request.user.role not in HISTORICAL_IMPORT_ROLES:
            return Response({"detail": "Solo admin o contador pueden confirmar historicos."}, status=status.HTTP_403_FORBIDDEN)
        if historical_import.status != "draft":
            return Response({"detail": "Esta importacion ya fue cerrada."}, status=status.HTTP_400_BAD_REQUEST)

        signature_name = request.data.get("signature_name", "").strip()
        if not signature_name:
            return Response({"detail": "Debes capturar quien firma la subida."}, status=status.HTTP_400_BAD_REQUEST)

        edited_rows = request.data.get("rows", [])
        row_map = {int(row["id"]): row for row in edited_rows if row.get("id")}
        created_income = created_expense = skipped = errors = 0
        target_rows = historical_import.rows.select_related("site").all()
        for row in target_rows:
            edited = row_map.get(row.id, {})
            if edited.get("skip"):
                row.status = "skipped"
                row.error = "Omitido manualmente en preview."
                row.save(update_fields=["status", "error", "updated_at"])
                skipped += 1
                continue
            try:
                site_id = edited.get("site") or row.site_id
                site = Site.objects.get(id=site_id)
                concept = (edited.get("concept") or row.concept).strip()
                amount = Decimal(str(edited.get("amount") or row.amount)).quantize(Decimal("0.01"))
                record_date = edited.get("record_date") or row.record_date
                row_type = edited.get("row_type") or row.row_type
                if row_type == "income":
                    payment = Payment.objects.create(
                        site=site,
                        method="transfer",
                        channel="transfer_clabe",
                        status="reconciled",
                        amount=amount,
                        paid_at=datetime.fromisoformat(str(record_date)).replace(tzinfo=timezone.get_current_timezone())
                        if isinstance(record_date, str)
                        else timezone.make_aware(datetime.combine(record_date, time.min)),
                        confirmed_at=timezone.now(),
                        reference=f"HIST-{historical_import.id}-{row.id}",
                        received_by=request.user,
                        notes=f"Historico Excel cerrado: {concept} ({row.sheet_name}, fila {row.source_row}). Firma: {signature_name}.",
                    )
                    row.target_table = "payments"
                    row.target_id = str(payment.id)
                    created_income += 1
                elif row_type == "expense":
                    expense = Expense.objects.create(
                        site=site,
                        category=row.concept_code or "Historico",
                        description=concept[:180],
                        amount=amount,
                        expense_date=record_date,
                        provider_name="Historico Excel",
                        status="approved",
                        captured_by=request.user,
                        approved_by=request.user,
                        approved_at=timezone.now(),
                    )
                    row.target_table = "expenses"
                    row.target_id = str(expense.id)
                    created_expense += 1
                elif row_type == "discrepancy":
                    row.target_table = "historical_discrepancies"
                    row.target_id = ""
                else:
                    raise ValueError("Tipo de fila invalido.")
                row.site = site
                row.concept = concept
                row.amount = amount
                row.record_date = record_date
                row.row_type = row_type
                row.status = "committed"
                row.error = ""
                row.save(update_fields=["site", "concept", "amount", "record_date", "row_type", "status", "target_table", "target_id", "error", "updated_at"])
            except Exception as exc:
                row.status = "error"
                row.error = str(exc)
                row.save(update_fields=["status", "error", "updated_at"])
                errors += 1

        historical_import.status = "committed" if errors == 0 else "draft"
        historical_import.committed_by = request.user
        historical_import.committed_at = timezone.now()
        historical_import.signature_name = signature_name
        historical_import.signature_role = request.data.get("signature_role", request.user.get_role_display())
        historical_import.summary = {
            **historical_import.summary,
            "created_income_payments": created_income,
            "created_expenses": created_expense,
            "skipped": skipped,
            "errors": errors,
        }
        historical_import.save(update_fields=["status", "committed_by", "committed_at", "signature_name", "signature_role", "summary", "updated_at"])
        AuditLog.objects.create(
            actor=request.user,
            action="historical_import_commit",
            table_name="historical_imports",
            record_id=str(historical_import.id),
            new_values=historical_import.summary,
            metadata={"signature_name": signature_name, "signature_role": historical_import.signature_role},
        )
        return Response(self.get_serializer(self.get_queryset().get(id=historical_import.id)).data)

    @action(detail=False, methods=["get"], url_path="discrepancies")
    def discrepancies(self, request):
        if request.user.role not in HISTORICAL_IMPORT_ROLES:
            return Response({"detail": "Solo admin o contador pueden ver discrepancias historicas."}, status=status.HTTP_403_FORBIDDEN)

        rows = (
            HistoricalImportRow.objects.select_related("historical_import", "site")
            .filter(row_type="discrepancy", status="committed")
            .order_by("-record_date", "site_name_raw", "concept")
        )
        site_filter = request.query_params.get("site")
        month_filter = request.query_params.get("month")
        severity_filter = request.query_params.get("severity")
        if site_filter:
            rows = rows.filter(site_id=site_filter)
        if month_filter:
            rows = rows.filter(month_label__iexact=month_filter)

        items = []
        summary_map = {}
        for row in rows:
            raw = row.raw_data or {}
            severity = raw.get("severity", "medium")
            if severity_filter and severity != severity_filter:
                continue
            site_label = row.site.name if row.site else row.site_name_raw or "Sin sede"
            month_label = row.month_label or (row.record_date.strftime("%Y-%m") if row.record_date else "Sin mes")
            missing_amount = Decimal(str(raw.get("estimated_missing_amount") or row.amount or "0"))
            paid_amount = Decimal(str(raw.get("paid_amount") or "0"))
            expected_amount = Decimal(str(raw.get("expected_amount") or row.amount or "0"))
            item = {
                "id": f"hist-{row.id}",
                "source": "historical",
                "site_id": row.site_id,
                "site_name": site_label,
                "month": month_label,
                "student_name": raw.get("student_name", row.concept),
                "guardian_name": raw.get("guardian_name", ""),
                "phone": raw.get("phone", ""),
                "category": raw.get("category", ""),
                "classes_attended": raw.get("classes_attended", 0),
                "folio": raw.get("folio", ""),
                "expected_amount": str(expected_amount),
                "paid_amount": str(paid_amount),
                "missing_amount": str(missing_amount if missing_amount > 0 else row.amount),
                "discrepancy_type": raw.get("discrepancy_type", "unknown"),
                "severity": severity,
                "status": row.status,
                "source_file": row.historical_import.original_filename,
                "source_row": row.source_row,
                "observations": raw.get("observations", ""),
            }
            items.append(item)
            key = (site_label, month_label)
            current = summary_map.setdefault(
                key,
                {
                    "site_name": site_label,
                    "month": month_label,
                    "total_cases": 0,
                    "high_risk": 0,
                    "missing_amount": Decimal("0"),
                    "classes_attended": 0,
                    "missing_folio": 0,
                    "no_payment": 0,
                    "partial_payment": 0,
                },
            )
            current["total_cases"] += 1
            current["classes_attended"] += int(item["classes_attended"] or 0)
            current["missing_amount"] += Decimal(str(item["missing_amount"] or "0"))
            if severity == "high":
                current["high_risk"] += 1
            if "folio" in item["discrepancy_type"]:
                current["missing_folio"] += 1
            if item["discrepancy_type"] in {"no_payment_no_folio", "no_payment_reported"}:
                current["no_payment"] += 1
            if item["discrepancy_type"] == "partial_payment":
                current["partial_payment"] += 1

        current_platform_items = []
        attendance_rows = (
            AttendanceRecord.objects.select_related("session", "session__site", "student", "student__guardian")
            .filter(status="present", student__isnull=False)
            .order_by("-session__date")[:300]
        )
        for record in attendance_rows:
            open_charges = Charge.objects.filter(student=record.student).exclude(status__in=["paid", "canceled"])
            for charge in open_charges:
                balance = charge_balance(charge)
                if balance <= 0:
                    continue
                payments = list(charge.payments.all())
                has_folio = any(payment.reference or payment.tracking_key or payment.payment_url for payment in payments)
                current_platform_items.append(
                    {
                        "id": f"current-{record.id}-{charge.id}",
                        "source": "platform",
                        "site_id": record.session.site_id,
                        "site_name": record.session.site.name,
                        "month": record.session.date.strftime("%Y-%m"),
                        "student_name": record.student.full_name,
                        "guardian_name": record.student.guardian.full_name,
                        "phone": record.student.guardian.phone,
                        "category": record.student.category,
                        "classes_attended": 1,
                        "folio": "Registrado" if has_folio else "",
                        "expected_amount": str(charge.amount),
                        "paid_amount": str(charge.amount - balance),
                        "missing_amount": str(balance),
                        "discrepancy_type": "current_attendance_with_open_balance" if has_folio else "current_attendance_without_folio",
                        "severity": "high",
                        "status": "open",
                        "source_file": "Plataforma actual",
                        "source_row": record.id,
                        "observations": f"Asistio el {record.session.date} con saldo abierto en {charge.concept}.",
                    }
                )

        summary = []
        for value in summary_map.values():
            summary.append({**value, "missing_amount": str(value["missing_amount"])})

        summary.sort(key=lambda item: (item["site_name"], item["month"]))
        return Response(
            {
                "summary": summary,
                "items": items,
                "current_platform_items": current_platform_items,
                "totals": {
                    "historical_cases": len(items),
                    "current_platform_cases": len(current_platform_items),
                    "high_risk": len([item for item in items if item["severity"] == "high"]),
                    "estimated_missing_amount": str(sum((Decimal(str(item["missing_amount"] or "0")) for item in items), Decimal("0"))),
                },
            }
        )

