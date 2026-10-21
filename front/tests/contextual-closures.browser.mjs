import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for (const width of [320,390,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5199/tests/communications-scope-preview.html?section=whatsapp&closing-regression');
    await page.locator('.comm-contact').first().waitFor();
    assert.match(await page.locator('.comm-inbox-tools').textContent(),/1 por responder/);
    await page.locator('.comm-contact').first().click();
    const chat=page.locator('.comm-messages');await chat.waitFor();
    assert.match(await chat.textContent(),/😊/);
    const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,composer:document.querySelector('.comm-composer').getBoundingClientRect().bottom}));
    assert(geometry.scrollWidth<=width);assert(geometry.composer<=900);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,one_real_pending:true,closed_emoji_exchange_not_pending:true,geometry,passed:true}));
    await page.close();
  }
} finally {await browser.close();}
