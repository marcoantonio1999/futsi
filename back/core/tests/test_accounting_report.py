from io import BytesIO

import pytest
from openpyxl import load_workbook


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_accounting_export_returns_valid_xlsx_for_accounting(login_client):
    client, _user = login_client("contador", "demo12345")

    response = client.get("/api/reports/accounting.xlsx")

    assert response.status_code == 200
    assert response["Content-Type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert response.content[:2] == b"PK"

    workbook = load_workbook(BytesIO(response.content), read_only=True)
    assert {
        "Resumen",
        "Pagos",
        "Cargos",
        "Gastos",
        "Descuentos",
        "Asistencia con adeudo",
        "Facturas",
    }.issubset(set(workbook.sheetnames))


def test_accounting_export_is_forbidden_for_cashier(login_client):
    client, _user = login_client("caja.roma", "demo12345")

    response = client.get("/api/reports/accounting.xlsx")

    assert response.status_code == 403
