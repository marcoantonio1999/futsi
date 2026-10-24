import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:5207';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
  const errors=[];let requests=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/recruitment-exams/statistics/'))requests++;});
  const login=await context.request.post(base+'/api/auth/login/',{data:{username:'exam_profiles_qa',password:'fictional-local-profile-2026'}});
  assert.equal(login.status(),200);const {token}=await login.json();
  const expected=await (await context.request.get(base+'/api/recruitment-exams/statistics/',{headers:{Authorization:'Token '+token}})).json();
  await page.addInitScript(t=>localStorage.setItem('futsi_token',t),token);
  await page.goto(base+'/#/examenes/estadisticas');
  const region=page.getByRole('region',{name:'Resultados por habilidad',exact:true});
  await region.waitFor();
  assert.equal(await region.getByRole('article').count(),6);
  const fits=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await fits();
  await page.getByLabel('Filtrar por habilidad',{exact:true}).selectOption('mathematics');
  assert.equal(await region.getByRole('article').count(),1);
  assert.equal(await region.locator('dd').first().textContent(),new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(expected.skills.results[0].average_score));
  assert.equal(await region.locator('dd').nth(5).textContent(),'1');
  await region.getByText('Ver por examen',{exact:true}).click();
  await region.getByText('QA habilidades (datos ficticios)',{exact:true}).waitFor();
  await fits();
  assert.equal(requests,1,'skill selection reuses aggregate results');
  assert((await region.locator('select,summary').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height))).every(h=>h>=44));
  await region.scrollIntoViewIfNeeded();
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-skill-statistics-${width}.png`,fullPage:true});
  await page.getByLabel('Filtrar por habilidad',{exact:true}).selectOption('sales');
  await region.getByRole('heading',{name:'Ventas y marketing',exact:true}).waitFor();
  await page.getByRole('button',{name:'Actualizar estadísticas',exact:true}).click();
  await page.getByRole('button',{name:'Actualizar estadísticas',exact:true}).waitFor();
  assert.equal(await region.getByRole('article').count(),1);
  await page.getByLabel('Filtrar por habilidad',{exact:true}).selectOption('');
  assert.equal(await region.getByRole('article').count(),6);
  await fits();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,skills:6,filter:true,mean:true,missingBreakdown:true,overflow:false,touch44:true}));
  await context.close();
 }
} finally {await browser.close();}
