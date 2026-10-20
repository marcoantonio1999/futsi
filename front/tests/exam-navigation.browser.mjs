import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base='http://127.0.0.1:5187/';
async function fits(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
try{
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'#/examenes');
  await page.getByLabel('Usuario',{exact:true}).fill('exam_qa_vero');await page.getByLabel('Contraseña',{exact:true}).fill('local-fictional-exam-test-2026');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.getByRole('heading',{name:'Mis exámenes',exact:true}).waitFor();
  await fits(page);
  if(width>900){
   const sidebar=page.locator('.exam-sidebar');assert(await sidebar.isVisible());
   assert((await sidebar.boundingBox()).x<(await page.locator('.exam-workspace-main').boundingBox()).x);
   for(const label of ['Crear examen','Mis exámenes','Ver evaluaciones']) assert(await sidebar.getByRole('button',{name:label,exact:true}).isVisible());
   await sidebar.getByRole('button',{name:'Crear examen',exact:true}).click();
  }else{
   assert(!(await page.locator('.exam-sidebar').isVisible()));
   await page.getByRole('button',{name:'Abrir menú de exámenes',exact:true}).click();
   const drawer=page.getByRole('dialog',{name:'Navegación de exámenes',exact:true});await drawer.waitFor();
   assert(await page.evaluate(()=>document.querySelector('dialog')===document.querySelector(':modal')));
   assert.equal(await page.getByRole('button',{name:'Abrir menú de exámenes'}).getAttribute('aria-expanded'),'true');
   await fits(page);await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-menu-${width}.png`});
   await drawer.getByRole('button',{name:'Crear examen',exact:true}).click();assert(!(await drawer.isVisible()));
  }
  await page.getByRole('heading',{name:'Crear examen',exact:true}).waitFor();await page.waitForURL('**/#/examenes/crear');
  await page.getByLabel('Nombre del examen',{exact:true}).fill('Borrador conservado');
  await fits(page);await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-sidebar-${width}.png`});
  async function select(label){if(width<=900)await page.getByRole('button',{name:'Abrir menú de exámenes'}).click();await page.getByRole('navigation',{name:'Menú de exámenes'}).filter({visible:true}).getByRole('button',{name:label,exact:true}).click();}
  await select('Ver evaluaciones');await page.getByRole('heading',{name:'Ver evaluaciones',exact:true}).waitFor();await page.waitForURL('**/#/examenes/evaluaciones');
  await page.goBack();await page.getByRole('heading',{name:'Crear examen',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Nombre del examen',{exact:true}).inputValue(),'Borrador conservado');
  await page.goForward();await page.getByRole('heading',{name:'Ver evaluaciones',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Ver evaluaciones',exact:true}).waitFor();
  await fits(page);
  if(width<=900){
   await page.getByRole('button',{name:'Abrir menú de exámenes'}).click();await page.keyboard.press('Escape');
   assert(!(await page.locator('dialog').isVisible()));
   await page.getByRole('button',{name:'Abrir menú de exámenes'}).click();await page.mouse.click(width-5,450);
   assert(!(await page.locator('dialog').isVisible()));
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,sidebar:width>900,drawer:width<=900,backForward:true,draftPreserved:true,reloadSection:true,overflow:false}));
  await context.close();
 }
}finally{await browser.close();}
