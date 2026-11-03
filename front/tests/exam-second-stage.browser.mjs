// Local SQLite and a local fake grading provider only; never against production.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EXAM_QA_URL || 'http://127.0.0.1:5193/';
assert(base.startsWith('http://127.0.0.1:'), 'Only the isolated local QA server may be used.');
const screenshots = process.env.EXAM_QA_OUTPUT || 'C:/Users/daniel/Documents/marco/mexprod/outputs';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
async function checkLayout(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(size.scroll <= size.width, JSON.stringify(size));
  const controls = await page.locator('.exam-second-controls button:visible').all();
  for (const button of controls) assert((await button.boundingBox()).height >= 44, await button.textContent());
}
try {
  const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; admin.on('pageerror', e => errors.push(e.message));
  await admin.goto(base + '#/examenes');
  await admin.getByLabel('Usuario', { exact: true }).fill('qa_segunda_fase');
  await admin.getByLabel('Contraseña', { exact: true }).fill('qa-fictional-2026');
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  const card = admin.locator('article.exam-card').filter({ hasText: 'Evaluación ficticia QA' });
  const linkInput = card.getByLabel('Enlace de la segunda fase');
  await linkInput.waitFor();
  assert.equal(await card.getByRole('button', { name: 'Activar segunda fase' }).count(), 0);
  const secondLink = await linkInput.inputValue();
  const firstLink = await card.getByLabel('Enlace para candidatos').inputValue();
  assert(secondLink.startsWith(base + '#/examen/'));
  assert.notEqual(firstLink, secondLink);
  const first = await browser.newPage({ viewport: { width: 320, height: 850 } });
  await first.goto(firstLink);
  await first.getByLabel('Nombre completo', { exact: true }).fill('Persona Primera Fase');
  await first.getByLabel('Correo electrónico', { exact: true }).fill('primera@example.invalid');
  await first.getByLabel('Teléfono', { exact: true }).fill('5512345678');
  await first.getByRole('checkbox').check();
  await first.getByRole('button', { name: 'Iniciar examen', exact: true }).click();
  await first.locator('#question-1').waitFor();
  await card.getByLabel('Duración de la segunda fase (minutos)').fill('35');
  await card.getByRole('button', { name: 'Guardar duración' }).click();
  await admin.getByText('Duración guardada para nuevos intentos', { exact: false }).waitFor();
  assert(await first.locator('#question-1').isVisible());
  for (const width of [320, 390, 1440]) { await admin.setViewportSize({ width, height: 850 }); await checkLayout(admin); }
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(secondLink);
    await page.getByText('35 minutos', { exact: true }).waitFor();
    await page.getByText('Usa el mismo correo y teléfono que registraste', { exact: false }).waitFor();
    await page.getByLabel('Nombre completo', { exact: true }).fill(`Participante Ficticio ${width}`);
    await page.getByLabel('Correo electrónico', { exact: true }).fill(`qa-${width}@example.invalid`);
    await page.getByLabel('Teléfono', { exact: true }).fill('550000' + String(width).padStart(4, '0'));
    await page.getByRole('checkbox').check();
    await checkLayout(page);
    await page.screenshot({ path: `${screenshots}/exam-second-start-${width}.png` });
    await page.getByRole('button', { name: 'Iniciar examen', exact: true }).click();
    await page.locator('#question-1 textarea').fill('Observé una mejora y organicé un cambio con el equipo.');
    await page.locator('#question-2 textarea').fill('Priorizamos y di seguimiento hasta completar el trabajo.');
    await page.locator('#question-3 textarea').fill('Escucharía la objeción y propondría una clase muestra; daría seguimiento.');
    await checkLayout(page);
    await page.screenshot({ path: `${screenshots}/exam-second-answer-${width}.png` });
    page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Enviar examen', exact: true }).click();
    await page.getByRole('heading', { name: 'Gracias. Recibimos tus respuestas.' }).waitFor();
    await checkLayout(page);
    assert.deepEqual(pageErrors, []);
    await page.close();
  }
  await card.getByRole('button', { name: 'Ver respuestas' }).click();
  await admin.getByRole('button', { name: 'Calificar segunda fase' }).waitFor();
  admin.on('dialog', dialog => dialog.accept());
  await admin.getByRole('button', { name: 'Calificar segunda fase' }).click();
  await admin.getByText('3 entregas procesadas', { exact: false }).waitFor();
  assert.equal(await admin.getByText('24 / 30', { exact: false }).count(), 3);
  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({ width, height: 850 });
    await checkLayout(admin);
    await admin.screenshot({ path: `${screenshots}/exam-second-results-${width}.png` });
  }
  await admin.getByRole('button', { name: 'Ver respuestas', exact: true }).first().click();
  await admin.getByRole('heading', { name: 'Segunda fase · evaluación complementaria' }).waitFor();
  assert.equal(await admin.locator('.exam-second-answer').count(), 3);
  assert.match(await admin.locator('.exam-second-detail').innerText(), /Total: 24 \/ 30/);
  assert.match(await admin.locator('.exam-second-detail').innerText(), /Ejemplo ficticio: revisar evidencia/);
  for (const width of [320, 390, 1440]) { await admin.setViewportSize({ width, height: 850 }); await checkLayout(admin); }
  assert(await first.locator('#question-1').isVisible(), 'La primera fase sigue en curso.');
  await first.close({ runBeforeUnload: false });
  assert.deepEqual(errors, []);
  console.log('Segunda fase: enlace, tres entregas, resultados vinculados, revisión y 320/390/1440 px OK; calificación simulada.');
} finally { await browser.close(); }
