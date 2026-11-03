// Isolated local Django/SQLite, with fictional profiles only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { navigateExamSection } from './exam-admin-navigation.mjs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EXAM_QA_URL || 'http://127.0.0.1:5193/';
assert(base.startsWith('http://127.0.0.1:'), 'This test must never access production.');
const screenshots = process.env.EXAM_QA_OUTPUT || 'C:/Users/daniel/Documents/marco/mexprod/outputs';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
async function fits(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must not overflow');
}
try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '#/examenes');
    await page.getByLabel('Usuario', { exact: true }).fill('qa_fechas_perfiles');
    await page.getByLabel('Contraseña', { exact: true }).fill('qa-fictional-profile-date');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('heading', { name: 'Mis exámenes', exact: true }).waitFor();
    await navigateExamSection(page, 'Perfiles');
    await page.getByText('4 perfiles encontrados', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filtros de perfiles' });
    await dialog.getByLabel('Buscar persona').fill('Candidato');
    await dialog.getByLabel('Fecha del examen desde').fill('2026-11-04');
    await dialog.getByLabel('Fecha del examen hasta').fill('2026-11-04');
    await dialog.getByLabel('Nota mínima').fill('7');
    for (const field of await dialog.locator('input[type=date]').all()) assert((await field.boundingBox()).height >= 44);
    await fits(page);
    await page.screenshot({ path: `${screenshots}/exam-profile-date-filter-${width}.png` });
    await dialog.getByRole('button', { name: 'Filtrar perfiles' }).click();
    await page.getByText('1 perfiles encontrados', { exact: true }).waitFor();
    const rows = page.locator(width <= 600 ? '.exam-profile-card' : '.exam-profile-table tbody tr');
    assert.equal(await rows.count(), 1);
    assert.match(await rows.first().innerText(), /Candidato Ana/);
    assert.match(await rows.first().innerText(), /04\/11\/2026/);
    await fits(page);
    await page.screenshot({ path: `${screenshots}/exam-profile-date-results-${width}.png` });
    await rows.first().getByRole('button', { name: 'Ver / editar perfil' }).click();
    await page.getByText('Fecha del examen: 04/11/2026').waitFor();
    await page.getByRole('button', { name: 'Volver a perfiles' }).click();
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    assert.equal(await dialog.getByLabel('Fecha del examen desde').inputValue(), '2026-11-04');
    await dialog.getByRole('button', { name: 'Limpiar filtros de perfiles' }).click();
    await page.getByText('4 perfiles encontrados', { exact: true }).waitFor();
    assert((await rows.allTextContents()).some(row => row.includes('Sin fecha registrada')));
    await fits(page); assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Filtro de fecha de perfiles: intervalos, filtros combinados, limpieza y 320/390/1440 px OK.');
} finally { await browser.close(); }
