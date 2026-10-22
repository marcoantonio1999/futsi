// Read-only mocked API: verify removed copy and preserved controls, no real data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-read-only-token'));
  await page.route('**/api/**',async route=>{
    const r=route.request();assert.equal(r.method(),'GET');
    const path=new URL(r.url()).pathname;
    const data=path==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
      path==='/api/recruitment-exams/'?{results:[{id:2,title:'Examen ficticio',public_token:'fake-exam'}]}:
      path==='/api/recruitment-applications/'?{public_url:'https://futsi.bpoweracademy.mx/#/postulacion',sections:[],results:[],count:0,page:1}:null;
    assert(data,`Unexpected read ${path}`);await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5207/#/examenes/formatos-postulaciones');
  const link=page.getByLabel('Enlace para postulantes',{exact:true});
  await page.getByText('0 formatos recibidos',{exact:true}).waitFor();
  await link.waitFor();assert.equal(await link.inputValue(),'https://futsi.bpoweracademy.mx/#/postulacion');
  assert.equal(await page.getByText('Soccer WA envía el enlace automáticamente',{exact:false}).count(),0);
  assert(await page.getByRole('button',{name:'Copiar enlace del formulario',exact:true}).isEnabled());
  assert.equal(await page.getByRole('link',{name:'Abrir formulario',exact:true}).getAttribute('href'),'https://futsi.bpoweracademy.mx/#/postulacion');
  await page.getByLabel(/^Asociar el enlace a un examen/).selectOption('fake-exam');
  assert.equal(await link.inputValue(),'https://futsi.bpoweracademy.mx/#/postulacion/fake-exam');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/application-copy-removed-${width}.png`,fullPage:true});
  console.log(JSON.stringify({width,textRemoved:true,linkControlsPreserved:true,examLinkWorks:true,overflow:false}));
  await context.close();
 }
} finally {await browser.close();}
