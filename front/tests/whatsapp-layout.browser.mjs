// Synthetic browser validation. All network access is intercepted by the preview fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:5179/tests/communications-scope-preview.html?section=whatsapp';
try {
  for (const [width,height] of [[1440,900],[1366,768],[1024,600],[390,844],[320,568]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors=[]; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('.comm-contact').first().click();
    await page.locator('.comm-messages .comm-message').nth(59).waitFor();
    const geometry = await page.evaluate(() => {
      const inbox=document.querySelector('.comm-inbox'), contacts=document.querySelector('.comm-contact-list'), messages=document.querySelector('.comm-messages'), composer=document.querySelector('.comm-composer');
      return { inboxBottom:inbox.getBoundingClientRect().bottom, composerBottom:composer.getBoundingClientRect().bottom, contactsScroll:contacts.scrollHeight>contacts.clientHeight, messagesScroll:messages.scrollHeight>messages.clientHeight, pageWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth };
    });
    assert(geometry.inboxBottom<=height); assert(geometry.composerBottom<=height); assert(geometry.messagesScroll); assert(geometry.pageWidth<=geometry.viewportWidth);
    if(width>767)assert(geometry.contactsScroll);
    await page.mouse.move(width-60,300); await page.mouse.wheel(0,700); assert.equal(await page.evaluate(()=>window.scrollY),0);
    if(width===1440)await page.screenshot({path:'tests/whatsapp-layout-desktop.png'});
    if(width===390)await page.screenshot({path:'tests/whatsapp-layout-mobile.png'});
    assert.deepEqual(errors,[]); console.log(JSON.stringify({width,height,passed:true,geometry})); await page.close();
  }
} finally { await browser.close(); }
