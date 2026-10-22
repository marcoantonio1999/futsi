// Full local browser -> Django -> SQLite round trip, fictional data only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {navigateExamSection} from './exam-admin-navigation.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:5203';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const api=await browser.newContext();
  const login=await api.request.post(base+'/api/auth/login/',{data:{username:'employment_qa',password:'fictional-local-employment-2026'}});
  assert.equal(login.status(),200,await login.text());const {token}=await login.json();
  const headers={Authorization:'Token '+token};
  for(const width of [320,390,1440]) {
    const title=`Puesto QA ${width} ${Date.now()}`;
    const created=await api.request.post(base+'/api/recruitment-exams/',{headers,data:{title,duration_minutes:60,questions:[{kind:'choice',prompt:'Pregunta ficticia',options:['Uno','Dos']}],answer_key:{'1':0}}});
    assert.equal(created.status(),201);const exam=await created.json();
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));let requests=0,first=true,lastBody;
    await page.route('**/api/public-employment-form/',async route=>{
      if(route.request().method()==='POST') {
        requests++;lastBody=route.request().postDataJSON();
        if(first){first=false;return route.fulfill({status:503,json:{detail:'Fallo de conexión ficticio. Intenta manualmente.'}});}
      }
      await route.continue();
    });
    await page.goto(base+'/#/postulacion/'+exam.public_token);
    await page.getByRole('heading',{name:'Solicitud de empleo',exact:true}).waitFor();
    await page.getByLabel('Nombre(s) *',{exact:true}).waitFor();
    await page.getByLabel('Nombre(s) *',{exact:true}).fill('Persona QA');
    await page.getByLabel('Apellido paterno *',{exact:true}).fill('Ficticia');
    await page.getByLabel('Correo electrónico *',{exact:true}).fill(`form${width}-${exam.id}@example.invalid`);
    const phone=`5500${String(exam.id).padStart(4,'0')}${width===320?'01':width===390?'02':'03'}`;
    await page.getByLabel('Teléfono *',{exact:true}).fill(phone);
    await page.getByLabel('Software que maneja',{exact:true}).fill('Excel, Python');
    await page.getByLabel('Nombre completo del solicitante *',{exact:true}).fill('Persona QA Ficticia');
    await page.getByRole('checkbox',{name:/Autorizo a BPower Academy/}).check();
    assert.equal(await page.getByLabel('Puesto que solicita *',{exact:true}).inputValue(),title);
    assert.equal(await page.getByLabel('Puesto que solicita *',{exact:true}).getAttribute('readonly'),'');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const small=await page.locator('input:not([type=checkbox]):visible,button:visible,summary:visible').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().height<44).map(e=>e.name||e.textContent));
    assert.deepEqual(small,[]);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/employment-form-${width}.png`,fullPage:true});
    await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/employment-form-header-${width}.png`});
    await page.getByRole('button',{name:'Enviar postulación',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Fallo de conexión ficticio'}).waitFor();
    assert.equal(requests,1);assert.equal(await page.getByLabel('Software que maneja',{exact:true}).inputValue(),'Excel, Python');
    await page.getByRole('button',{name:'Enviar postulación',exact:true}).click();
    await page.getByRole('heading',{name:'Gracias. Recibimos tu postulación.',exact:true}).waitFor();
    assert.equal(requests,2);assert.equal(await page.getByRole('button',{name:'Enviar postulación',exact:true}).count(),0);
    const duplicate=await api.request.post(base+'/api/public-employment-form/',{data:lastBody});assert.equal(duplicate.status(),200);
    // A real exam submission triggers linking, not a poll or scheduled worker.
    const started=await api.request.post(base+`/api/public-exams/${exam.public_token}/`,{data:{start_key:crypto.randomUUID(),name:'Persona QA Ficticia',email:lastBody.fields.correo,phone,consent:true}});
    assert.equal(started.status(),201);const access=(await started.json()).access_token;
    const delivered=await api.request.post(base+'/api/public-exams/attempt/',{headers:{Authorization:'Exam '+access},data:{answers:{'1':0}}});assert.equal(delivered.status(),200);
    const admin=await context.newPage();await admin.addInitScript(t=>localStorage.setItem('futsi_token',t),token);
    await admin.goto(base+'/#/examenes');await admin.getByRole('heading',{name:'Mis exámenes',exact:true}).waitFor();
    await navigateExamSection(admin,'Formatos postulaciones');
    await admin.getByRole('heading',{name:'Formatos postulaciones',exact:true}).waitFor();
    await admin.getByLabel('Buscar en los datos del formato',{exact:true}).fill(lastBody.fields.correo);
    await admin.getByRole('button',{name:'Filtrar formatos',exact:true}).click();
    await admin.getByText('1 formatos recibidos',{exact:true}).waitFor();
    await admin.getByText('Vinculado a examen',{exact:true}).waitFor();
    await admin.getByLabel(/^Asociar el enlace a un examen/).selectOption(exam.public_token);
    assert.equal(await admin.getByLabel('Enlace para postulantes',{exact:true}).inputValue(),'https://futsi.bpoweracademy.mx/#/postulacion/'+exam.public_token);
    assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await admin.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/employment-admin-${width}.png`,fullPage:true});
    await admin.getByRole('button',{name:'Ver todos los datos',exact:true}).click();
    await admin.getByText('Excel, Python',{exact:true}).waitFor();
    assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const profile=await api.request.get(base+'/api/recruitment-profiles/?form_q=Python',{headers});
    assert((await profile.json()).results.some(r=>r.exam_id===exam.id&&r.has_form&&r.score===10));
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,publicSubmit:true,manualRetryOnly:true,idempotent:true,privateListing:true,formBeforeExamLinked:true,scorePreserved:true,overflow:false}));
    await context.close();
  }
  await api.close();
}finally{await browser.close();}
