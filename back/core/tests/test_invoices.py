import pytest

from core.models import Charge, Expense, Invoice


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_accounting_can_generate_invoice_for_charge_and_download_pdf_xml(login_client):
    client, _user = login_client("contador", "demo12345")
    charge = Charge.objects.select_related("student").filter(student__isnull=False).first()

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

    pdf_response = client.get(f"/api/invoices/{invoice_id}/pdf/")
    assert pdf_response.status_code == 200
    assert pdf_response["Content-Type"] == "application/pdf"

    xml_response = client.get(f"/api/invoices/{invoice_id}/xml/")
    assert xml_response.status_code == 200
    assert "application/xml" in xml_response["Content-Type"]
    assert str(response.json()["uuid"]) in xml_response.content.decode("utf-8")


def test_accounting_can_generate_invoice_for_expense(login_client):
    client, _user = login_client("contador", "demo12345")
    expense = Expense.objects.first()

    response = client.post(
        "/api/invoices/simulate/",
        {"source_type": "expense", "source_id": expense.id, "tax_rate": "0"},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["kind"] == "expense"
    assert Invoice.objects.filter(id=response.json()["id"], expense=expense).exists()


def test_cashier_cannot_generate_invoices(login_client):
    client, _user = login_client("caja.roma", "demo12345")
    charge = Charge.objects.first()

    response = client.post(
        "/api/invoices/simulate/",
        {"source_type": "charge", "source_id": charge.id},
        format="json",
    )

    assert response.status_code == 403
