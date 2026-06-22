import pytest

from .pages.base import BasePage
from .pages.login_page import LoginPage


pytestmark = pytest.mark.e2e


def test_accounting_portal_has_export_and_invoice_controls(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("contador", "demo12345", "accounting-portal")
    page = BasePage(driver)

    page.testid("accounting-export")
    page.wait_text("Reporte contable operativo")
    page.wait_text("Facturas simuladas")


def test_cashier_portal_has_payment_controls_without_admin_tabs(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("caja.roma", "demo12345", "admin-portal")
    page = BasePage(driver)

    page.testid("cashier-create-payment")
    assert not page.has_testid("tab-users")


def test_coach_portal_has_attendance_camera_and_hours_controls(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("coach.roma", "demo12345", "coach-portal")
    page = BasePage(driver)

    page.testid("coach-register-hours")
    page.wait_text("Horas y nomina estimada")
    page.click_testid("menu-tab-attendance")
    page.wait_text("Sesiones de hoy")
    page.wait_text("Agenda del dia")


def test_guardian_portal_shows_debts_profile_and_invoices(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("padre.laura", "familia12345", "guardian-portal")
    page = BasePage(driver)

    assert page.has_text("Mis alumnos")
    assert page.source_has("Perfil")
    assert page.source_has("Mis facturas")
