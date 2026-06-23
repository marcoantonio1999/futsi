from .common import *

def build_invoice_xml(invoice):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Serie="DEMO" Folio="{invoice.id}" Fecha="{invoice.issued_at.isoformat()}" SubTotal="{invoice.subtotal}" Moneda="MXN" Total="{invoice.total}" TipoDeComprobante="{'I' if invoice.kind == 'income' else 'E'}" xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
  <cfdi:Emisor Rfc="FUTSI010101XXX" Nombre="Futsi Operacion Demo" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="{invoice.recipient_tax_id or 'XAXX010101000'}" Nombre="{invoice.recipient_name}" DomicilioFiscalReceptor="00000" RegimenFiscalReceptor="616" UsoCFDI="G03" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="{invoice.concept}" ValorUnitario="{invoice.subtotal}" Importe="{invoice.subtotal}" ObjetoImp="01" />
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="{invoice.uuid}" FechaTimbrado="{invoice.issued_at.isoformat()}" RfcProvCertif="PAC010101DEMO" SelloCFD="SIMULADO" NoCertificadoSAT="00001000000000000000" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" />
  </cfdi:Complemento>
</cfdi:Comprobante>
"""


def build_invoice_pdf(invoice):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(54, height - 60, "Factura simulada Futsi")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(54, height - 82, "Documento demo para Sprint 2. No tiene validez fiscal.")
    rows = [
        ("UUID", str(invoice.uuid)),
        ("Tipo", invoice.get_kind_display()),
        ("Receptor", invoice.recipient_name),
        ("RFC", invoice.recipient_tax_id or "XAXX010101000"),
        ("Correo", invoice.recipient_email or "Sin correo"),
        ("Concepto", invoice.concept),
        ("Subtotal", f"${invoice.subtotal}"),
        ("IVA", f"${invoice.tax}"),
        ("Total", f"${invoice.total}"),
        ("Fecha", invoice.issued_at.strftime("%Y-%m-%d %H:%M")),
    ]
    y = height - 125
    for label, value in rows:
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(54, y, f"{label}:")
        pdf.setFont("Helvetica", 10)
        pdf.drawString(150, y, str(value)[:80])
        y -= 24
    pdf.setFont("Courier", 7)
    xml_preview = (invoice.xml_content or "").splitlines()[:18]
    y -= 16
    pdf.drawString(54, y, "XML simulado:")
    y -= 12
    for line in xml_preview:
        pdf.drawString(54, y, line[:110])
        y -= 10
        if y < 60:
            break
    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer.getvalue()


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Invoice.objects.select_related("site", "student", "guardian", "coach", "charge", "payment", "expense", "issued_by").all()
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset().order_by("-issued_at")
        if self.request.user.role == "guardian":
            return queryset.filter(guardian__user=self.request.user)
        if self.request.user.role == "coach":
            return queryset.filter(coach=self.request.user)
        if self.request.user.role == "cashier":
            return queryset.filter(site=self.request.user.primary_site)
        return queryset

    @action(detail=False, methods=["post"], url_path="simulate")
    def simulate(self, request):
        if request.user.role not in {"admin", "owner", "accounting"}:
            return Response({"detail": "Solo contabilidad o administracion puede generar facturas."}, status=status.HTTP_403_FORBIDDEN)

        source_type = request.data.get("source_type")
        source_id = request.data.get("source_id")
        tax_rate = Decimal(str(request.data.get("tax_rate", "0")))
        invoice_data = {"issued_by": request.user}

        if source_type == "expense":
            expense = Expense.objects.select_related("site").get(id=source_id)
            invoice_data.update(
                kind="expense",
                expense=expense,
                site=expense.site,
                recipient_name=expense.provider_name or "Proveedor demo",
                recipient_tax_id=request.data.get("recipient_tax_id", "XAXX010101000"),
                recipient_email=request.data.get("recipient_email", ""),
                concept=f"Gasto: {expense.category} - {expense.description}",
                subtotal=expense.amount,
            )
        elif source_type == "charge":
            charge = Charge.objects.select_related("site", "student", "student__guardian", "team").get(id=source_id)
            guardian = charge.student.guardian if charge.student else None
            team = charge.team
            recipient_name = (
                (guardian.tax_name or guardian.full_name)
                if guardian
                else (team.representative_name if team and team.representative_name else "Cliente general")
            )
            recipient_email = guardian.email if guardian else (team.representative_email if team else "")
            invoice_data.update(
                kind="income",
                charge=charge,
                site=charge.site,
                student=charge.student,
                guardian=guardian,
                recipient_name=recipient_name,
                recipient_tax_id=guardian.tax_id if guardian else "XAXX010101000",
                recipient_email=recipient_email,
                concept=f"Ingreso: {charge.concept} - {charge.description or 'Cobro operativo'}",
                subtotal=charge.amount,
            )
        elif source_type == "payment":
            payment = Payment.objects.select_related("site", "charge", "student", "student__guardian", "team").get(id=source_id)
            guardian = payment.student.guardian if payment.student else None
            team = payment.team
            recipient_name = (
                (guardian.tax_name or guardian.full_name)
                if guardian
                else (team.representative_name if team and team.representative_name else "Cliente general")
            )
            recipient_email = guardian.email if guardian else (team.representative_email if team else "")
            invoice_data.update(
                kind="income",
                payment=payment,
                charge=payment.charge,
                site=payment.site,
                student=payment.student,
                guardian=guardian,
                recipient_name=recipient_name,
                recipient_tax_id=guardian.tax_id if guardian else "XAXX010101000",
                recipient_email=recipient_email,
                concept=f"Ingreso pagado: {payment.charge.concept if payment.charge else payment.get_method_display()}",
                subtotal=payment.amount,
            )
        else:
            return Response({"detail": "source_type debe ser expense, charge o payment."}, status=status.HTTP_400_BAD_REQUEST)

        subtotal = Decimal(invoice_data["subtotal"])
        tax = (subtotal * tax_rate).quantize(Decimal("0.01"))
        invoice_data["tax"] = tax
        invoice_data["total"] = subtotal + tax
        invoice = Invoice.objects.create(**invoice_data)
        invoice.xml_content = build_invoice_xml(invoice)
        invoice.pdf_file.save(f"factura-demo-{invoice.uuid}.pdf", ContentFile(build_invoice_pdf(invoice)), save=False)
        invoice.save(update_fields=["xml_content", "pdf_file", "updated_at"])
        return Response(self.get_serializer(invoice).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        invoice = self.get_object()
        if not invoice.pdf_file:
            invoice.pdf_file.save(f"factura-demo-{invoice.uuid}.pdf", ContentFile(build_invoice_pdf(invoice)), save=True)
        return FileResponse(invoice.pdf_file.open("rb"), as_attachment=True, filename=f"factura-demo-{invoice.uuid}.pdf")

    @action(detail=True, methods=["get"])
    def xml(self, request, pk=None):
        invoice = self.get_object()
        response = HttpResponse(invoice.xml_content or build_invoice_xml(invoice), content_type="application/xml")
        response["Content-Disposition"] = f'attachment; filename="factura-demo-{invoice.uuid}.xml"'
        return response

