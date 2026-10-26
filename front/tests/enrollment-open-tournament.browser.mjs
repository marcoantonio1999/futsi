// Synthetic catalog only. Opening tournaments must never show another tournament's teams.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/tournament-open';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try { for (const width of [320,390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    assert.equal(route.request().method(),'GET','No production writes');
    const catalog={sites:[{id:1,name:'Sede ficticia'}],
      tournaments:[1,2,3].map(id=>({id,site:1,name:`Torneo ${id}`,is_active:true,billing_type:'weekly_match'})),
      teams:[{id:11,tournament:1,name:'Equipo Uno',is_active:true},{id:22,tournament:2,name:'Equipo Dos',is_active:true}]};
    await route.fulfill({json:route.request().url().includes('/catalog/')?catalog:{results:[],count:0}});
  });
  await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/tournament-overview');
  const list=page.getByRole('region',{name:'Lista de equipos',exact:true});
  async function open(id) {
    await page.getByRole('button',{name:`Abrir torneo Torneo ${id}`,exact:true}).click();
    await list.waitFor();
    assert.equal(await page.locator('.tournament-context-select select').inputValue(),String(id));
  }
  await open(1);
  assert.match(await list.innerText(),/Equipo Uno/); assert.doesNotMatch(await list.innerText(),/Equipo Dos/);
  await page.screenshot({path:`${output}/selected-${width}.png`});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.reload(); await list.waitFor();
  assert.equal(await page.locator('.tournament-context-select select').inputValue(),'1');
  assert.doesNotMatch(await list.innerText(),/Equipo Dos/);
  await page.goBack(); await open(2);
  assert.match(await list.innerText(),/Equipo Dos/); assert.doesNotMatch(await list.innerText(),/Equipo Uno/);
  await page.locator('.tournament-context-select select').selectOption('');
  assert.match(await list.innerText(),/Equipo Uno/); assert.match(await list.innerText(),/Equipo Dos/);
  await page.goBack(); await open(3);
  assert.match(await list.innerText(),/No hay equipos/); assert.doesNotMatch(await list.innerText(),/Equipo Uno|Equipo Dos/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,selectedOnly:true,refreshPreservesFilter:true,switchTournament:true,allOption:true,emptyTournament:true,noOverflow:true}));
  await page.close();
}} finally {await browser.close();}
