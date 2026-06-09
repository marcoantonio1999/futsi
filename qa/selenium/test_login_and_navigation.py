import pytest
from selenium.webdriver.common.by import By

from .pages.base import BasePage
from .pages.login_page import LoginPage


pytestmark = pytest.mark.e2e


def test_invalid_login_stays_on_login_page(driver, live_frontend):
    page = LoginPage(driver).open(live_frontend)
    page.login("admin' OR 1=1 --", "incorrecto")

    assert page.has_testid("login-page")
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
