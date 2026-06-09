from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


class BasePage:
    def __init__(self, driver, timeout=45):
        self.driver = driver
        self.wait = WebDriverWait(driver, timeout)

    def testid(self, value):
        return self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, f"[data-testid='{value}']")))

    def clickable_testid(self, value):
        return self.wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, f"[data-testid='{value}']")))

    def click_testid(self, value):
        self.clickable_testid(value).click()

    def fill_testid(self, value, text):
        field = self.clickable_testid(value)
        field.clear()
        field.send_keys(text)

    def wait_text(self, text):
        return self.wait.until(EC.text_to_be_present_in_element((By.TAG_NAME, "body"), text))

    def wait_not_busy(self, testid):
        self.wait.until(lambda driver: not driver.find_element(By.CSS_SELECTOR, f"[data-testid='{testid}']").get_attribute("disabled"))

    def has_testid(self, value):
        return bool(self.driver.find_elements(By.CSS_SELECTOR, f"[data-testid='{value}']"))

    def has_text(self, text):
        return text in self.driver.find_element(By.TAG_NAME, "body").text

    def source_has(self, text):
        return text in self.driver.page_source
