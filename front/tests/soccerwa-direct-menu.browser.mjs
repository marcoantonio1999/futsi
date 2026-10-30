import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const output=new URL('../../../outputs/soccerwa-direct-menu/',import.meta.url);
await mkdir(output,{recursive:true});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',()=>{throw new Error('Navigation must not request production data');});
  await page.route('**/tests/soccer-wa-logo.png',route=>route.continue({url:'http://127.0.0.1:5209/soccer-wa-logo.png'}));
  await page.goto('http://127.0.0.1:5209/tests/soccerwa-direct-menu.html');
  const mobile=width<1024;
  if(mobile) await page.getByRole('button',{name:'Abrir menú',exact:true}).click();
  const nav=page.getByRole('navigation',{name:'Comunicaciones de mi cancha'}).filter({visible:true});
  await nav.waitFor();
  const menu=page.locator('aside').filter({visible:true});
  for(const text of ['Comunicaciones y llamadas','Soccer WA','General','ACADEMIA','Mini ERP operativo'])
   assert.equal(await menu.getByText(text,{exact:true}).count(),0);
  assert(await menu.getByRole('img',{name:'Soccer WA',exact:true}).isVisible());
  assert.equal(await page.getByTestId('menu-tab-communications').filter({visible:true}).count(),0);
  for(const label of ['Nuevo envío masivo','Historial de envíos','Bandeja de WhatsApp','Plantillas de WhatsApp','Configurar horario laboral']){
   const button=nav.getByRole('button',{name:label,exact:true});
   assert(await button.isVisible());assert((await button.boundingBox()).height>=44);
  }
  assert(await nav.getByText('Auditoría de WhatsApp',{exact:true}).isVisible());
  assert(await nav.getByRole('button',{name:'Resumen',exact:true}).isVisible());
  await page.screenshot({path:new URL(`menu-${width}.png`,output).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  await nav.getByRole('button',{name:'Nuevo envío masivo',exact:true}).click();
  await page.locator('output').filter({hasText:'bulk-academy'}).waitFor();
  if(mobile) assert.equal(await page.getByTestId('section-menu-dropdown').count(),0);
  else{
   await page.getByTestId('sidebar-toggle').click();
   await page.getByTestId('menu-tab-communications').click();
   assert(await nav.getByRole('button',{name:'Nuevo envío masivo',exact:true}).isVisible());
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,communicationLevelRemoved:true,bulkAlwaysVisible:true,navigation:true,overflow:false}));
  await page.close();
 }
}finally{await browser.close();}
