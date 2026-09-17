// Local, synthetic data only; never sends a WhatsApp message.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true,channel:'chrome'});
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5179/tests/veronica-preview.html';
try {
 for (const [width,height] of [[1440,900],[1366,768],[1024,600],[390,844],[320,568]]) {
  const page = await browser.newPage({viewport:{width,height}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button',{name:/Contacto de prueba/}).click();
  await page.getByText('Mensaje de prueba 60.',{exact:false}).waitFor();
  await page.getByText('Ventana de atención cerrada',{exact:true}).waitFor();
  assert.equal(await page.locator('.vero-composer textarea').count(),0);
  await page.locator('.vero-composer select').waitFor();
  const geometry = await page.evaluate(()=>{
   const history=document.querySelector('.vero-history'),contacts=document.querySelector('.vero-contacts'),editor=document.querySelector('.vero-composer'),panel=document.querySelector('.veronica-console');
   return {historyScroll:history.scrollHeight>history.clientHeight,contactsScroll:contacts.scrollHeight>contacts.clientHeight,panelBottom:panel.getBoundingClientRect().bottom,editorBottom:editor.getBoundingClientRect().bottom,editorHeight:editor.clientHeight,width:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert(geometry.historyScroll);assert(geometry.editorHeight>0);assert(geometry.panelBottom<=height);assert(geometry.editorBottom<=height);assert(geometry.width<=geometry.viewport);
  if(width>850)assert(geometry.contactsScroll);
  await page.mouse.move(width-100,300);await page.mouse.wheel(0,500);
  assert.equal(await page.evaluate(()=>window.scrollY),0);
  await page.getByRole('button',{name:'PDF automático',exact:true}).click();
  await page.getByRole('dialog',{name:'PDF automático',exact:true}).waitFor();
  await page.getByText('Cambiar PDF o mensaje',{exact:true}).click();
  await page.getByRole('button',{name:'Elegir PDF',exact:true}).waitFor();
  if(width===1440)await page.screenshot({path:'tests/veronica-layout-pdf.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.locator('.vero-heading-actions').getByRole('button',{name:'Actualizar',exact:true}).waitFor({state:'visible'});
  if(width===1440)await page.screenshot({path:'tests/veronica-layout-desktop.png'});
  if(width===390){await page.screenshot({path:'tests/veronica-layout-mobile.png'});await page.getByRole('button',{name:'Conversaciones',exact:true}).click();await page.getByRole('button',{name:'Nuevo destinatario'}).click();await page.getByRole('textbox',{name:'Destinatario (10 dígitos)'}).waitFor();await page.locator('.vero-new-recipient-state').getByText('Nuevo destinatario',{exact:true}).waitFor();}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,height,passed:true,geometry}));
  await page.close();
 }
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.goto(base);await page.getByRole('button',{name:/Contacto de prueba/}).click();
 await page.getByRole('button',{name:'Enviar plantilla',exact:true}).waitFor();
 assert((await page.getByRole('button',{name:'Enviar plantilla',exact:true}).boundingBox()).y<768);
 await page.getByRole('button',{name:'Enviar plantilla',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirmar envío desde Verónica'}).waitFor();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 console.log('Closed-window template confirmation passed without sending.');
 const openPage=await browser.newPage({viewport:{width:1366,height:768}});
 await openPage.goto(base+'?open');await openPage.getByRole('button',{name:/Contacto de prueba/}).click();
 await openPage.locator('.vero-composer textarea').waitFor();assert.equal(await openPage.locator('.vero-composer select').count(),0);
 console.log('Open-window free-text composer passed.');await openPage.close();
 const recipientPage=await browser.newPage({viewport:{width:1366,height:768}});
 await recipientPage.goto(base);await recipientPage.getByRole('button',{name:'Nuevo destinatario'}).click();
 await recipientPage.getByRole('textbox',{name:'Nombre del destinatario'}).waitFor();
 await recipientPage.waitForTimeout(250);
 await recipientPage.getByRole('textbox',{name:'Destinatario (10 dígitos)'}).fill('5522578778');
 await recipientPage.getByRole('textbox',{name:'Nombre del destinatario'}).fill('Vero');
 await recipientPage.getByRole('button',{name:'Enviar plantilla',exact:true}).click();
 await recipientPage.getByRole('button',{name:'Confirmar envío',exact:true}).click();
 await recipientPage.getByRole('status').filter({hasText:'Aceptado por la API · aún no confirma entrega'}).waitFor();
 assert.deepEqual(await recipientPage.evaluate(()=>window.__lastVeronicaSend.parameters),{'body:1':'Vero'});
 console.log('New-recipient template variables passed through the UI.');await recipientPage.close();
} finally {await browser.close();}
