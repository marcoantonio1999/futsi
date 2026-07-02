from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from core.models import Expense, Invoice
from core.tests.factories import make_charge, make_site, make_student, make_user


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_accounting_can_generate_invoice_for_charge_and_download_pdf_xml(auth_client):
    site = make_site(code="qa-invoice-charge")
    accounting = make_user(role="accounting", primary_site=site)
    student = make_student(site=site)
    charge = make_charge(student=student, amount=Decimal("1000.00"), description="Cargo factura QA")
    client, _payload, _user = auth_client(user=accounting)

    response = client.post(
        "/api/invoices/simulate/",
        {"source_type": "charge", "source_id": charge.id, "tax_rate": "0.16"},
        format="json",
    )

    assert response.status_code == 201
    invoice_id = response.json()["id"]
    assert response.json()["uuid"]
    assert response.json()["total"] != response.json()["subtotal"]
    assert Invoice.objects.filter(id=invoice_id, charge=charge).exists()

    with CaptureQueriesContext(connection) as captured:
        list_response = client.get("/api/invoices/")
    assert list_response.status_code == 200
    invoice_payload = next(item for item in list_response.json() if item["id"] == invoice_id)
    assert invoice_payload["site_name"]
    assert invoice_payload["student_name"] == charge.student.full_name
    assert invoice_payload["guardian_name"]
    assert invoice_payload["charge_concept"] == charge.concept
    assert invoice_payload["issued_by_username"] == accounting.username
    assert str(response.json()["uuid"]) in invoice_payload["xml_content"]
    assert len(captured) <= 2

    with CaptureQueriesContext(connection) as pdf_queries:
        pdf_response = client.get(f"/api/invoices/{invoice_id}/pdf/")
    assert pdf_response.status_code == 200
    assert pdf_response["Content-Type"] == "application/pdf"
    b"".join(pdf_response.streaming_content)
    pdf_invoice_query = next(query["sql"] for query in pdf_queries if 'FROM "invoices"' in query["sql"])
    assert "xml_content" not in pdf_invoice_query
    assert "JOIN" not in pdf_invoice_query
    assert len(pdf_queries) <= 2

    with CaptureQueriesContext(connection) as xml_queries:
        xml_response = client.get(f"/api/invoices/{invoice_id}/xml/")
    assert xml_response.status_code == 200
    assert "application/xml" in xml_response["Content-Type"]
    assert str(response.json()["uuid"]) in xml_response.content.decode("utf-8")
    xml_invoice_query = next(query["sql"] for query in xml_queries if 'FROM "invoices"' in query["sql"])
    assert "pdf_file" not in xml_invoice_query
    assert "JOIN" not in xml_invoice_query
    assert len(xml_queries) <= 2


def test_accounting_can_generate_invoice_for_expense(auth_client):
    site = make_site(code="qa-invoice-expense")
    accounting = make_user(role="accounting", username="qa-accounting-expense", primary_site=site)
    expense = Expense.objects.create(
        site=site,
        category="Arbitraje",
        description="Gasto facturable QA",
        amount=Decimal("300.00"),
        expense_date=timezone.localdate(),
        provider_name="Proveedor QA",
        status="approved",
        captured_by=accounting,
        approved_by=accounting,
    )
    client, _payload, _user = auth_client(user=accounting)

    response = client.post(
        "/api/invoices/simulate/",
        {"source_type": "expense", "source_id": expense.id, "tax_rate": "0"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["kind"] == "expense"
    assert Invoice.objects.filter(id=response.json()["id"], expense=expense).exists()


def test_cashier_cannot_generate_invoices(auth_client):
    site = make_site(code="qa-invoice-cashier")
    cashier = make_user(role="cashier", username="qa-invoice-cashier", primary_site=site)
    charge = make_charge(student=make_student(site=site))
    client, _payload, _user = auth_client(user=cashier)

    response = client.post(
        "/api/invoices/simulate/",
        {"source_type": "charge", "source_id": charge.id},
        format="json",
    )

    assert response.status_code == 403
