// Isolated local Django/SQLite, with fictional evaluations only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '#/examenes');
    await page.getByLabel('Usuario', { exact: true }).fill('qa_fechas_perfiles');
    await page.getByLabel('Contraseña', { exact: true }).fill('qa-fictional-profile-date');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('heading', { name: 'Mis exámenes', exact: true }).waitFor();
    const exam = page.locator('article.exam-card').filter({ hasText: 'Examen ficticio de perfiles' });
    await exam.getByRole('button', { name: 'Ver respuestas' }).click();
    await page.getByText('4 participantes', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Filtros de evaluaciones' });
    await dialog.getByLabel('Fecha del examen desde').fill('2026-11-04');
    await dialog.getByLabel('Fecha del examen hasta').fill('2026-11-04');
    await dialog.getByLabel('Calificación general mínima').fill('7');
    for (const field of await dialog.locator('input[type=date]').all()) assert((await field.boundingBox()).height >= 44);
    await fits(page);
    await page.screenshot({ path: `${screenshots}/exam-result-date-filter-${width}.png` });
    const response = page.waitForResponse(response => response.url().includes('/recruitment-exams/') && response.url().includes('date_from='));
    await dialog.getByRole('button', { name: 'Aplicar filtros' }).click();
    const filtered = await response;
    assert.equal(filtered.status(), 200);
    const query = new URL(filtered.url()).searchParams;
    for (const [key, value] of Object.entries({ date_from: '2026-11-04', date_to: '2026-11-04', min_score: '7' })) assert.equal(query.get(key), value);
    await page.getByText('1 participantes', { exact: false }).waitFor();
    const rows = page.locator('.exam-table-wrap tbody tr');
    assert.equal(await rows.count(), 1);
    assert.match(await rows.first().innerText(), /Candidato Ana/);
    await fits(page);
    await page.screenshot({ path: `${screenshots}/exam-result-date-results-${width}.png` });
    const exported = page.waitForResponse(response => response.url().includes('/recruitment-exams/export/'));
    await page.getByRole('button', { name: 'Exportar Excel' }).click();
    const excel = await exported;
    assert.equal(excel.status(), 200);
    const exportQuery = new URL(excel.url()).searchParams;
    for (const [key, value] of Object.entries({ date_from: '2026-11-04', date_to: '2026-11-04', min_score: '7' })) assert.equal(exportQuery.get(key), value);
    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    assert.equal(await dialog.getByLabel('Fecha del examen desde').inputValue(), '2026-11-04');
    await dialog.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
    await page.getByText('4 participantes', { exact: false }).waitFor();
    assert.equal(await rows.count(), 4);
    await fits(page);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Filtro de evaluaciones y Excel: intervalos, combinación, limpieza y 320/390/1440 px OK.');
} finally { await browser.close(); }
