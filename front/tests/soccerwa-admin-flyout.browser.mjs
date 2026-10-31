import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const output=new URL('../../../outputs/soccerwa-admin-flyout/',import.meta.url);
await mkdir(output,{recursive:true});
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',()=>{throw new Error('No API requests allowed');});
  await page.route('**/tests/soccer-wa-logo.png',route=>route.continue({url:'http://127.0.0.1:5209/soccer-wa-logo.png'}));
  await page.goto('http://127.0.0.1:5209/tests/soccerwa-direct-menu.html?admin=1');
  const mobile=width<1024;
  const openDrawer=async()=>{if(mobile)await page.getByRole('button',{name:'Abrir menú',exact:true}).click();};
  await openDrawer();
  const nav=page.getByRole('navigation',{name:'Áreas de Soccer WA',exact:true}).filter({visible:true});
  await nav.waitFor({timeout:10000}).catch(async error=>{
   console.log(JSON.stringify({width,errors,navigation:await page.locator('nav').evaluateAll(elements=>elements.map(el=>({label:el.getAttribute('aria-label'),display:getComputedStyle(el).display,parent:el.parentElement?.outerHTML.slice(0,300)})))}));
   throw error;
  });
  for(const label of ['Canchas','RRHH','Agenda','Gestión']) assert(await nav.getByRole('button',{name:label,exact:true}).isVisible());
  const courts=nav.getByRole('button',{name:'Canchas',exact:true});
  assert((await courts.boundingBox()).height>=44);
  assert.equal(await page.getByRole('button',{name:'Nuevo envío masivo',exact:true}).count(),0);
  await courts.focus();await courts.press('Enter');
  const panel=mobile?page.getByRole('region',{name:'Opciones de Canchas'}):page.getByRole('dialog',{name:'Canchas',exact:true});
  await panel.waitFor();
  for(const label of ['Nuevo envío masivo','Historial de envíos','Bandeja de WhatsApp','Plantillas de WhatsApp','Crear plantilla','Resumen','Calidad de chats','Histórico de primera respuesta','Llamadas']){
   const button=panel.getByRole('button',{name:label,exact:true});assert(await button.isVisible());assert((await button.boundingBox()).height>=44);
  }
  if(!mobile){
   const a=await courts.boundingBox(),b=await panel.boundingBox();assert(b.x>=a.x+a.width,'flyout must open to the right');assert(b.y>=0 && b.x+b.width<=width);
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert(await courts.evaluate(el=>el===document.activeElement));
   await courts.click();await panel.waitFor();await page.getByRole('heading',{name:'Prueba de navegación',exact:true}).click();await panel.waitFor({state:'hidden'});
   await courts.click();await panel.waitFor();
  }
  await page.screenshot({path:fileURLToPath(new URL(`canchas-${width}.png`,output)),fullPage:true});
  await panel.getByRole('button',{name:'Nuevo envío masivo',exact:true}).click();
  await page.locator('output').filter({hasText:'bulk-academy'}).waitFor();
  if(mobile)assert.equal(await page.getByTestId('section-menu-dropdown').count(),0);
  else assert.equal(await page.getByRole('dialog').count(),0);
  await openDrawer();await nav.getByRole('button',{name:'RRHH',exact:true}).click();
  const hr=mobile?page.getByRole('region',{name:'Opciones de RRHH'}):page.getByRole('dialog',{name:'RRHH',exact:true});
  await hr.getByRole('button',{name:'Exámenes',exact:true}).waitFor();
  await hr.getByRole('button',{name:'Exámenes',exact:true}).click();
  await page.locator('output').filter({hasText:'veronica-exams'}).waitFor();
  await openDrawer();await nav.getByRole('button',{name:'Gestión',exact:true}).click();
  const management=mobile?page.getByRole('region',{name:'Opciones de Gestión'}):page.getByRole('dialog',{name:'Gestión',exact:true});
  await management.getByRole('button',{name:'Configurar horario laboral',exact:true}).waitFor();
  if(mobile){await management.getByRole('button',{name:'Volver al menú'}).click();assert(await nav.isVisible());}
  else await page.keyboard.press('Escape');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,adminCategories:4,clickAndKeyboard:true,rightFlyout:!mobile,mobilePanel:mobile,navigation:true,overflow:false}));
  await page.close();
 }
}finally{await browser.close();}
