// Real local Django/SQLite, fictional exam data. Never production or paid AI.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:5205';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
  let requests=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/recruitment-exams/statistics/')){requests++;assert.equal(r.method(),'GET');}});
  const login=await context.request.post(base+'/api/auth/login/',{data:{username:'exam_profiles_qa',password:'fictional-local-profile-2026'}});
  assert.equal(login.status(),200);const {token}=await login.json(),headers={Authorization:'Token '+token};
  const expected=await (await context.request.get(base+'/api/recruitment-exams/statistics/',{headers})).json();
  assert(expected.summary.delivered>0);
  await page.addInitScript(t=>localStorage.setItem('futsi_token',t),token);
  await page.goto(base+'/#/examenes');
  await page.getByRole('heading',{name:'Mis exámenes',exact:true}).waitFor();
  if(width<=900)await page.getByRole('button',{name:'Abrir menú de exámenes'}).click();
  await page.getByRole('navigation',{name:'Menú de exámenes'}).filter({visible:true}).getByRole('button',{name:'Estadísticas',exact:true}).click();
  await page.getByRole('region',{name:'Promedios de actividad'}).waitFor();
  if(width<=900)assert(!(await page.getByRole('dialog',{name:'Navegación de exámenes'}).isVisible()));
  assert.equal(requests,1);
  const region=page.getByRole('region',{name:'Promedios de actividad'});
  const daily=region.getByRole('article').filter({has:page.getByRole('heading',{name:'Por día',exact:true})});
  assert.equal(await daily.locator('strong').textContent(),new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(expected.averages.received.daily));
  const summary=page.getByRole('region',{name:'Resumen de resultados'});
  assert.equal(await summary.getByRole('article').filter({has:page.getByRole('heading',{name:'Evaluaciones recibidas',exact:true})}).locator('strong').textContent(),String(expected.summary.delivered));
  await page.getByLabel('Indicador de los promedios',{exact:true}).selectOption('created_by_vero');
  assert.equal(requests,1);assert.equal(await daily.locator('strong').textContent(),new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(expected.averages.created_by_vero.daily));
  await page.getByLabel('Indicador de los promedios',{exact:true}).selectOption('received');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.locator('.exam-stat-days').evaluate(e=>e.scrollHeight>=e.clientHeight));
  const controls=await page.locator('.exam-statistics button,.exam-statistics input,.exam-statistics select').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));
  assert(controls.every(h=>h>=44));
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-statistics-${width}.png`,fullPage:true});
  const until=await page.getByLabel('Hasta',{exact:true}).inputValue();
  await page.getByLabel('Desde',{exact:true}).fill(until);
  await page.getByRole('button',{name:'Actualizar estadísticas',exact:true}).click();
  await page.getByText('(1 días naturales, incluidos días sin actividad).',{exact:false}).waitFor();
  assert.equal(requests,2);
  await page.route('**/api/recruitment-exams/statistics/**',route=>route.fulfill({status:503,json:{detail:'Fallo ficticio de consulta'}}));
  await page.getByRole('button',{name:'Actualizar estadísticas',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'No se reintentará automáticamente.'}).waitFor();
  assert.equal(requests,3);assert.equal(await region.count(),0);
  await page.waitForTimeout(2500);assert.equal(requests,3,'no automatic retry/polling');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,realLocalAPI:true,averagesCorrect:true,creatorSeparate:true,dateFilters:true,noPolling:true,errorNoRetry:true,mobileDrawerClosed:true,touch44:true,overflow:false}));
  await context.close();
 }
} finally {await browser.close();}
