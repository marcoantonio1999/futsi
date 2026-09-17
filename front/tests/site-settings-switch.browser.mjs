// Local, synthetic data only; never changes a real chatbot.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,channel:'chrome'});
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5179/tests/site-settings-preview.html';
try {
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(base);
  const toggle = page.getByRole('switch',{name:'Respuestas automáticas del chatbot'});
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal(await toggle.getAttribute('data-state'),'off');
  assert(await toggle.getByText('Apagado',{exact:true}).isVisible());
  assert((await toggle.getAttribute('class')).includes('bg-red-600'));
  assert.equal(await page.evaluate(()=>window.__siteSettingsPatchCount),0);

  page.once('dialog',dialog=>dialog.dismiss());
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal(await page.evaluate(()=>window.__siteSettingsPatchCount),0);

  page.once('dialog',dialog=>dialog.accept());
  await toggle.click();
  await page.getByRole('switch',{name:'Respuestas automáticas del chatbot'}).filter({hasText:'Prendido'}).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'true');
  assert.equal(await toggle.getAttribute('data-state'),'on');
  assert((await toggle.getAttribute('class')).includes('bg-emerald-700'));
  assert.equal(await page.evaluate(()=>window.__siteSettingsPatchCount),1);

  await toggle.click();
  await page.getByRole('switch',{name:'Respuestas automáticas del chatbot'}).filter({hasText:'Apagado'}).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal(await toggle.getAttribute('data-state'),'off');
  assert((await toggle.getAttribute('class')).includes('bg-red-600'));
  assert.equal(await page.evaluate(()=>window.__siteSettingsPatchCount),2);
  await page.screenshot({path:'tests/site-settings-switch.png',fullPage:true});
  console.log('Chatbot switch stays off on load and clearly toggles red/off to green/on.');
} finally {
  await browser.close();
}
