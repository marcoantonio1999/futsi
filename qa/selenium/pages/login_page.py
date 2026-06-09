from .base import BasePage


class LoginPage(BasePage):
    def open(self, url):
        self.driver.get(url)
        self.driver.execute_script("localStorage.removeItem('futsi_token'); sessionStorage.clear();")
        self.driver.get(url)
        self.testid("login-page")
        return self

    def login(self, username, password, portal_testid=None):
        self.fill_testid("login-username", username)
        self.fill_testid("login-password", password)
        self.click_testid("login-submit")
        if portal_testid:
            self.testid(portal_testid)
        return self
