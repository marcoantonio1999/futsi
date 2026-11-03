// Uses only a copied local SQLite database containing fictional participants.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EXAM_QA_URL || 'http://127.0.0.1:5195/';
assert(base.startsWith('http://127.0.0.1:'), 'This test must never access production.');
const output = process.env.EXAM_QA_OUTPUT || 'C:/Users/daniel/Documents/marco/mexprod/outputs';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
async function fits(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must not overflow');
}
try {
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const admin = await context.newPage();
    const errors = [];
    admin.on('pageerror', error => errors.push(error.message));
    await admin.goto(base + '#/examenes');
    await admin.getByLabel('Usuario', { exact: true }).fill('qa_segunda_fase');
    await admin.getByLabel('Contraseña', { exact: true }).fill('qa-fictional-2026');
    await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    const card = admin.locator('article.exam-card').filter({ hasText: 'Evaluación ficticia QA' });
    const firstLink = await card.getByLabel('Enlace para candidatos').inputValue();
    const secondLink = await card.getByLabel('Enlace de la segunda fase').inputValue();
    assert.match(await card.innerText(), /participantes que hayan entregado la primera fase/i);
    assert.doesNotMatch(await card.innerText(), /al menos 8 en Gestión/i);
    await fits(admin);
    for (const button of await card.locator('.exam-second-controls button:visible').all()) assert((await button.boundingBox()).height >= 44);
    await admin.screenshot({ path: `${output}/exam-second-unrestricted-admin-${width}.png` });

    const email = `libre-${width}@example.invalid`;
    const first = await context.newPage();
    first.on('pageerror', error => errors.push(error.message));
    await first.goto(firstLink);
    await first.getByLabel('Nombre completo', { exact: true }).fill('Persona Prueba Libre');
    await first.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await first.getByLabel('Teléfono', { exact: true }).fill(`5590000${width}`);
    await first.getByRole('checkbox').check();
    await first.getByRole('button', { name: 'Iniciar examen', exact: true }).click();
    for (let i = 1; i <= 40; i++) await first.locator(`#question-${i} input[type=radio]`).nth(1).check();
    first.on('dialog', dialog => dialog.accept());
    await first.getByRole('button', { name: 'Enviar examen', exact: true }).click();
    await first.getByRole('heading', { name: 'Gracias. Recibimos tus respuestas.' }).waitFor();
    await fits(first);

    const second = await context.newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(secondLink);
    await second.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await second.getByRole('checkbox').check();
    await second.getByRole('button', { name: 'Iniciar examen', exact: true }).click();
    await second.locator('#question-1 textarea').fill('Detecté una oportunidad y propuse una mejora concreta.');
    await second.locator('#question-2 textarea').fill('Organicé las prioridades y di seguimiento.');
    await second.locator('#question-3 textarea').fill('Escucharía la objeción y propondría una clase muestra.');
    await fits(second);
    await second.screenshot({ path: `${output}/exam-second-unrestricted-exam-${width}.png` });
    second.on('dialog', dialog => dialog.accept());
    await second.getByRole('button', { name: 'Enviar examen', exact: true }).click();
    await second.getByRole('heading', { name: 'Gracias. Recibimos tus respuestas.' }).waitFor();

    await card.getByRole('button', { name: 'Ver respuestas' }).click();
    const row = admin.locator('.exam-table-wrap tbody tr').filter({ hasText: email });
    await row.waitFor();
    const content = await row.innerText();
    assert.match(content, /Primera fase entregada/);
    assert.match(content, /Gestión: 0\.00 \/ 10/);
    assert.match(content, /Ventas: 0\.00 \/ 10/);
    assert.match(content, /Entregado · pendiente de calificar/);
    await row.getByRole('button', { name: 'Ver respuestas' }).click();
    await admin.getByRole('heading', { name: 'Segunda fase · evaluación complementaria' }).waitFor();
    assert.match(await admin.locator('.exam-second-detail').innerText(), /Detecté una oportunidad/);
    await fits(admin);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Segunda fase con 0/10 en Gestión y Ventas: ambas entregas vinculadas en 320/390/1440 px OK.');
} finally { await browser.close(); }
