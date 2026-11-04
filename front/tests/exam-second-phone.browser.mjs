// Uses only an isolated local database containing fictional applicants.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EXAM_QA_URL || 'http://127.0.0.1:5197/';
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
    const secondLink = await card.getByLabel('Enlace de la segunda fase').inputValue();
    const applicant = await context.newPage();
    applicant.on('pageerror', error => errors.push(error.message));
    await applicant.goto(secondLink);
    await applicant.getByRole('button', { name: 'Con nombre y teléfono' }).click();
    assert.equal(await applicant.getByLabel('Correo electrónico').count(), 0);
    await applicant.getByLabel('Nombre completo').fill(`CANDIDATO HISTORICO ${width}`);
    await applicant.getByLabel('Teléfono').fill('5512349999');
    await applicant.getByRole('checkbox').check();
    for (const control of await applicant.locator('form button:visible, form input:not([type=checkbox]):visible').all()) assert((await control.boundingBox()).height >= 44);
    await fits(applicant);
    await applicant.screenshot({ path: `${output}/exam-phone-access-${width}.png` });
    await applicant.getByRole('button', { name: 'Iniciar examen' }).click();
    await applicant.getByRole('alert').getByText('No fue posible vincular esta participación.', { exact: false }).waitFor();
    const phone = `551234${String(width).padStart(4, '0')}`;
    await applicant.getByLabel('Teléfono').fill(phone);
    await applicant.getByRole('button', { name: 'Iniciar examen' }).click();
    await applicant.locator('#question-1 textarea').fill('Detecté una mejora y propuse una solución.');
    await applicant.locator('#question-2 textarea').fill('Priorizamos y terminamos el trabajo.');
    await applicant.locator('#question-3 textarea').fill('Escucharía a la mamá y propondría una clase muestra.');
    await fits(applicant);
    applicant.on('dialog', dialog => dialog.accept());
    await applicant.getByRole('button', { name: 'Enviar examen' }).click();
    await applicant.getByRole('heading', { name: 'Gracias. Recibimos tus respuestas.' }).waitFor();
    await applicant.close();

    const noHistoricalPhone = await context.newPage();
    noHistoricalPhone.on('pageerror', error => errors.push(error.message));
    await noHistoricalPhone.goto(secondLink);
    await noHistoricalPhone.getByRole('button', { name: 'Con nombre y teléfono' }).click();
    await noHistoricalPhone.getByLabel('Nombre completo').fill(`Candidato Sin Numero ${width}`);
    await noHistoricalPhone.getByLabel('Teléfono').fill(`553456${String(width).padStart(4, '0')}`);
    await noHistoricalPhone.getByRole('checkbox').check();
    await noHistoricalPhone.getByRole('button', { name: 'Iniciar examen' }).click();
    await noHistoricalPhone.locator('#question-1 textarea').fill('Una mejora específica.');
    await noHistoricalPhone.locator('#question-2 textarea').fill('Un plan para terminar.');
    await noHistoricalPhone.locator('#question-3 textarea').fill('Una respuesta amable y seguimiento.');
    noHistoricalPhone.on('dialog', dialog => dialog.accept());
    await noHistoricalPhone.getByRole('button', { name: 'Enviar examen' }).click();
    await noHistoricalPhone.getByRole('heading', { name: 'Gracias. Recibimos tus respuestas.' }).waitFor();
    await fits(noHistoricalPhone);
    await noHistoricalPhone.close();

    await card.getByRole('button', { name: 'Ver respuestas' }).click();
    const row = admin.locator('.exam-table-wrap tbody tr').filter({ hasText: `Candidato Historico ${width}` });
    const reviewRow = admin.locator('.exam-table-wrap tbody tr').filter({ hasText: `Candidato Sin Numero ${width}` });
    await row.waitFor();
    assert.match(await row.innerText(), /9\.75 \/ 10/);
    assert.match(await row.innerText(), new RegExp(phone));
    assert.match(await row.innerText(), /Entregado · pendiente de calificar/);
    await row.getByRole('button', { name: 'Ver respuestas' }).click();
    assert.match(await admin.locator('.exam-second-detail').innerText(), /Detecté una mejora/);
    await fits(admin);
    await admin.screenshot({ path: `${output}/exam-phone-result-${width}.png` });
    await admin.getByRole('button', { name: 'Volver a participantes' }).click();
    assert.match(await reviewRow.innerText(), /Vinculada por nombre: verificar identidad/);
    await reviewRow.getByRole('button', { name: 'Ver respuestas' }).click();
    assert.match(await admin.locator('.exam-second-detail').innerText(), /Vinculada por nombre: verificar identidad/);
    await fits(admin);

    const emailCandidate = await context.newPage();
    emailCandidate.on('pageerror', error => errors.push(error.message));
    await emailCandidate.goto(secondLink);
    await emailCandidate.getByLabel('Correo electrónico').fill(`email-candidato-${width}@example.invalid`);
    await emailCandidate.getByRole('checkbox').check();
    await emailCandidate.getByRole('button', { name: 'Iniciar examen' }).click();
    await emailCandidate.locator('#question-1 textarea').waitFor();
    await fits(emailCandidate);
    await emailCandidate.close();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Segunda fase por nombre y teléfono y por correo: vínculo y 320/390/1440 px OK.');
} finally { await browser.close(); }
