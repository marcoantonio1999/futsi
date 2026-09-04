import pytest
from selenium.webdriver.common.by import By

from .pages.base import BasePage
from .pages.login_page import LoginPage


pytestmark = pytest.mark.e2e


def test_invalid_login_stays_on_login_page(driver, live_frontend):
    page = LoginPage(driver).open(live_frontend)
    page.login("admin' OR 1=1 --", "incorrecto")

    assert page.has_testid("login-form")
    page.wait_not_busy("login-submit")
    assert page.has_text("Usuario o password incorrecto.")


def test_admin_navigation_theme_and_mobile_menu(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("admin", "admin12345", "admin-portal")
    page = BasePage(driver)

    before = driver.execute_script("return document.documentElement.classList.contains('dark')")
    page.click_testid("theme-toggle")
    page.wait.until(lambda browser: browser.execute_script("return document.documentElement.classList.contains('dark')") != before)

    page.click_testid("menu-tab-students")
    page.wait_text("Alumnos")
    page.click_testid("menu-tab-historical")
    page.testid("historical-preview-submit")

    driver.set_window_size(390, 844)
    page.click_testid("section-menu-open")
    page.testid("section-menu-dropdown")
    assert page.source_has('data-testid="menu-tab-dashboard"')

    assert not driver.find_elements(By.CSS_SELECTOR, "[data-testid='login-page']")


def test_dev_user_enters_admin_portal_for_diagnostics(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("dev", "dev12345", "admin-portal")
    page = BasePage(driver)

    assert page.has_text("Dev App")
    page.click_testid("menu-tab-users")
    page.wait_text("Usuarios")


def test_admin_can_save_whatsapp_business_days_without_unrelated_reload_error(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("admin", "admin12345", "admin-portal")
    page = BasePage(driver)

    page.click_testid("menu-tab-communications")
    page.click_testid("communications-subsection-settings")
    page.wait_text("Configuración del bot")

    saturday = page.clickable_testid("whatsapp-business-day-5")
    if saturday.get_attribute("aria-pressed") == "true":
        saturday.click()
        saturday = page.clickable_testid("whatsapp-business-day-5")
    saturday.click()

    driver.execute_script(
        """
        window.__futsiRequests = [];
        if (!window.__futsiOriginalFetch) window.__futsiOriginalFetch = window.fetch;
        window.fetch = (...args) => {
          window.__futsiRequests.push(String(args[0]));
          return window.__futsiOriginalFetch(...args);
        };
        """
    )
    page.click_testid("whatsapp-settings-save")
    page.wait_text("Configuración del bot actualizada.")

    assert page.testid("whatsapp-business-day-5").get_attribute("aria-pressed") == "true"
    assert not page.has_text("No se pudo completar la accion.")
    requested_urls = driver.execute_script("return window.__futsiRequests")
    assert any("/whatsapp-automation-settings/current/" in url for url in requested_urls)
    assert not any("/trial-availability-rules/" in url for url in requested_urls)
