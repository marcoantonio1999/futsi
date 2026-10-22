// Real local Django/SQLite round trip with fictional CV PDFs; never production.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:5204',pdfs='C:/Users/daniel/Documents/marco/mexprod/tmp/pdfs/cv-import-qa';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const width of [320,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),calls=[];
    const login=await context.request.post(base+'/api/auth/login/',{data:{username:'exam_profiles_qa',password:'fictional-local-profile-2026'}});
    assert.equal(login.status(),200);const {token}=await login.json(),headers={Authorization:'Token '+token};
    const records=await (await context.request.get(base+'/api/recruitment-profiles/?q=qa0@example.invalid',{headers})).json();
    assert.equal(records.count,1);const id=records.results[0].id;
    const before=await (await context.request.get(base+`/api/recruitment-profiles/${id}/`,{headers})).json();
    await page.addInitScript(t=>localStorage.setItem('futsi_token',t),token);
    page.on('request',r=>{if(r.url().includes('/recruitment-profiles/import-cv/')){assert.match(r.headers()['content-type'],/application\/json/);assert(!r.postData().includes('%PDF'));calls.push(r.postDataJSON());}});
    await page.goto(base+'/#/examenes/perfiles');
    await page.getByRole('button',{name:'Cargar carpeta de CV',exact:true}).click();
    await page.getByLabel('Seleccionar CV sueltos PDF o TXT',{exact:true}).setInputFiles([pdfs+'/cv-matched.pdf',pdfs+'/cv-unmatched.pdf']);
    await page.getByText('Carga finalizada.',{exact:true}).waitFor();
    const panel=page.getByRole('region',{name:'Cargar CV por carpeta'});
    const matched=panel.locator('.exam-import-row').filter({hasText:'cv-matched.pdf'});
    assert.match(await matched.locator('strong').textContent(),/Perfil actualizado|CV idéntico/);
    assert.equal(await panel.getByText('Sin coincidencia',{exact:true}).count(),1);
    assert.equal(calls.length,3);assert.equal(calls.filter(c=>c.commit).length,1);
    const after=await (await context.request.get(base+`/api/recruitment-profiles/${id}/`,{headers})).json();
    assert(after.cv_text.includes('Excel, Python y SQL'));
    assert.equal(after.form_text,before.form_text);assert.deepEqual(after.form_fields,before.form_fields);
    assert.equal(after.position,before.position);assert.equal(after.score,before.score);
    assert.equal((await (await context.request.get(base+'/api/recruitment-profiles/?q=cv-missing@example.invalid',{headers})).json()).count,0);
    const filtered=await (await context.request.get(base+'/api/recruitment-profiles/?keywords=Python&keyword_mode=all',{headers})).json();
    assert(filtered.results.some(p=>p.id===id));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log(JSON.stringify({width,realPdfToText:true,realLocalProfileUpdated:true,formAndGradePreserved:true,unmatchedNotCreated:true}));
    await context.close();
  }
}finally{await browser.close();}
