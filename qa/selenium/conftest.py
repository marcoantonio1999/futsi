import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options


REPO_ROOT = Path(__file__).resolve().parents[2]
BACK_DIR = REPO_ROOT / "back"
FRONT_DIR = REPO_ROOT / "front"
ARTIFACT_DIR = REPO_ROOT / "qa" / "artifacts"
DOWNLOAD_DIR = ARTIFACT_DIR / "downloads"


def _is_windows():
    return os.name == "nt"


def _wait_for_url(url, timeout=60):
    started = time.time()
    last_error = None
    while time.time() - started < timeout:
        try:
            with urlopen(url, timeout=3) as response:
                if response.status < 500:
                    return
        except Exception as exc:  # pragma: no cover - diagnostic path
            last_error = exc
            time.sleep(0.5)
    raise RuntimeError(f"Timed out waiting for {url}: {last_error}")


def _run_checked(command, cwd, env):
    result = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(command)}\n{result.stdout}")


def _terminate(process):
    if process.poll() is not None:
        return
    if _is_windows():
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


@pytest.fixture(scope="session")
def e2e_config():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    api_port = os.getenv("FUTSI_E2E_API_PORT", "8100")
    web_port = os.getenv("FUTSI_E2E_WEB_PORT", "5176")
    return {
        "api_port": api_port,
        "web_port": web_port,
        "api_url": f"http://127.0.0.1:{api_port}/api",
        "health_url": f"http://127.0.0.1:{api_port}/health/",
        "frontend_url": f"http://127.0.0.1:{web_port}",
    }


@pytest.fixture(scope="session")
def live_backend(e2e_config):
    if os.getenv("FUTSI_E2E_REUSE_SERVERS") == "1":
        _wait_for_url(e2e_config["health_url"], timeout=30)
        return e2e_config["api_url"]

    db_path = ARTIFACT_DIR / "e2e.sqlite3"
    if db_path.exists():
        db_path.unlink()

    env = os.environ.copy()
    for name in (
        "DATABASE_URL",
        "SUPABASE_DATABASE_URL",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "SUPABASE_DB_NAME",
        "SUPABASE_DB_USER",
        "SUPABASE_DB_PASSWORD",
        "SUPABASE_DB_HOST",
        "SUPABASE_DB_PORT",
    ):
        env.pop(name, None)
    env.update(
        {
            "DB_ENGINE": "sqlite",
            "ALLOW_SQLITE": "true",
            "FUTSI_ENV": "demo",
            "ALLOW_DESTRUCTIVE_SEED": "true",
            "DJANGO_DEBUG": "true",
            "DJANGO_TEST_FAST_PASSWORD_HASHERS": "true",
            "SQLITE_DATABASE_PATH": str(db_path),
            "DJANGO_ALLOWED_HOSTS": "localhost,127.0.0.1,testserver",
            "CORS_ALLOWED_ORIGINS": f"http://127.0.0.1:{e2e_config['web_port']},http://localhost:{e2e_config['web_port']}",
            "CSRF_TRUSTED_ORIGINS": f"http://127.0.0.1:{e2e_config['web_port']},http://localhost:{e2e_config['web_port']}",
            "DEBUG": "1",
        }
    )
    python = sys.executable
    _run_checked([python, "manage.py", "migrate", "--noinput"], cwd=BACK_DIR, env=env)
    _run_checked([python, "manage.py", "seed_demo", "--reset"], cwd=BACK_DIR, env=env)

    backend_log = (ARTIFACT_DIR / "django-e2e.log").open("w", encoding="utf-8")
    process = subprocess.Popen(
        [python, "manage.py", "runserver", f"127.0.0.1:{e2e_config['api_port']}", "--noreload"],
        cwd=BACK_DIR,
        env=env,
        stdout=backend_log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _wait_for_url(e2e_config["health_url"], timeout=60)
        yield e2e_config["api_url"]
    finally:
        _terminate(process)
        backend_log.close()


@pytest.fixture(scope="session")
def live_frontend(e2e_config, live_backend):
    if os.getenv("FUTSI_E2E_REUSE_SERVERS") == "1":
        _wait_for_url(e2e_config["frontend_url"], timeout=30)
        return e2e_config["frontend_url"]

    npm = "npm.cmd" if _is_windows() else "npm"
    if not (FRONT_DIR / "node_modules").exists():
        _run_checked([npm, "ci"], cwd=FRONT_DIR, env=os.environ.copy())

    env = os.environ.copy()
    env.update({"VITE_API_URL": live_backend, "VITE_BASE_PATH": "/"})
    vite_log = (ARTIFACT_DIR / "vite-e2e.log").open("w", encoding="utf-8")
    process = subprocess.Popen(
        [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", e2e_config["web_port"]],
        cwd=FRONT_DIR,
        env=env,
        stdout=vite_log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _wait_for_url(e2e_config["frontend_url"], timeout=90)
        yield e2e_config["frontend_url"]
    finally:
        _terminate(process)
        vite_log.close()


@pytest.fixture
def driver():
    options = Options()
    if os.getenv("FUTSI_E2E_HEADLESS", "1") != "0":
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1440,1000")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_experimental_option(
        "prefs",
        {
            "download.default_directory": str(DOWNLOAD_DIR),
            "download.prompt_for_download": False,
            "safebrowsing.enabled": True,
        },
    )
    browser = webdriver.Chrome(options=options)
    browser.set_page_load_timeout(45)
    yield browser
    browser.quit()


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" or not report.failed:
        return
    browser = item.funcargs.get("driver")
    if not browser:
        return
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", item.nodeid)
    browser.save_screenshot(str(ARTIFACT_DIR / f"{safe_name}.png"))
    (ARTIFACT_DIR / f"{safe_name}.html").write_text(browser.page_source, encoding="utf-8")
