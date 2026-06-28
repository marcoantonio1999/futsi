from .base import BasePage
from selenium.common.exceptions import TimeoutException


class LoginPage(BasePage):
    def open(self, url):
        self.driver.get(url)
        self.driver.execute_script("localStorage.removeItem('futsi_token'); sessionStorage.clear();")
        self.driver.get(url)
        try:
            button = self.testid("landing-login-button")
            self.driver.execute_script("arguments[0].click();", button)
            self.testid("landing-login-modal")
        except TimeoutException:
            pass
        self.testid("login-form")
        return self

    def login(self, username, password, portal_testid=None):
        self.fill_testid("login-username", username)
        self.fill_testid("login-password", password)
        self.click_testid("login-submit")
        if portal_testid:
            self.testid(portal_testid)
        return self
