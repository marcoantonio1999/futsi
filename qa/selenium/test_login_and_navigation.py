import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import Select

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


def test_admin_can_save_24_7_whatsapp_settings_without_unrelated_reload_error(driver, live_frontend):
    LoginPage(driver).open(live_frontend).login("admin", "admin12345", "admin-portal")
    page = BasePage(driver)

    page.click_testid("menu-tab-communications")
    page.click_testid("communications-subsection-settings")
    page.wait_text("Configuración por sede y número")

    number_select = page.testid("communications-number-select")
    page.wait.until(lambda _driver: len(Select(number_select).options) > 1)
    selected_address = Select(number_select).options[1].get_attribute("value")
    Select(number_select).select_by_index(1)
    page.wait_text(f"Editando {selected_address.replace('whatsapp:', '')}")

    delay_field = page.testid("whatsapp-human-delay-minutes")
    driver.execute_script("arguments[0].closest('details').open = true;", delay_field)
    page.wait_text("La atención se considera disponible todos los días y a cualquier hora.")
    delay_field = page.clickable_testid("whatsapp-human-delay-minutes")
    current_delay = int(delay_field.get_attribute("value"))
    new_delay = str(current_delay + 1 if current_delay < 60 else current_delay - 1)
    delay_field.send_keys(Keys.ARROW_UP if current_delay < 60 else Keys.ARROW_DOWN)
    page.wait.until(lambda _driver: page.testid("whatsapp-human-delay-minutes").get_attribute("value") == new_delay)

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
    page.wait_text("Todos los cambios están guardados.")

    assert page.testid("whatsapp-human-delay-minutes").get_attribute("value") == new_delay
    assert not page.has_text("No se pudo completar la accion.")
    requested_urls = driver.execute_script("return window.__futsiRequests")
    assert any("/whatsapp-automation-settings/current/" in url for url in requested_urls)
    assert not any("/trial-availability-rules/" in url for url in requested_urls)
