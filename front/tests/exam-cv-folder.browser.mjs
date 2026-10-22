// Local browser/PDF extraction regression, mocked API and fictional contacts only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=await mkdtemp(join(tmpdir(),'cv-import-browser-qa-'));
const folder=join(fixture,'cvs'),empty=join(fixture,'sin-cvs');
const pdfs='C:/Users/daniel/Documents/marco/mexprod/tmp/pdfs/cv-import-qa';
await mkdir(join(folder,'subcarpeta'),{recursive:true});await mkdir(empty);
for(let i=0;i<21;i++)await writeFile(join(folder,`extra-${i}.TXT`),`Persona Ficticia ${i}\nCorreo: extra${i}@example.invalid\nPERFIL\nExcel Python`);
await copyFile(join(pdfs,'cv-matched.pdf'),join(folder,'cv-matched.pdf'));
await copyFile(join(pdfs,'cv-unmatched.pdf'),join(folder,'subcarpeta','cv-unmatched.pdf'));
await copyFile(join(pdfs,'cv-partial.pdf'),join(folder,'cv-partial.pdf'));
await copyFile(join(pdfs,'cv-no-text.pdf'),join(folder,'cv-no-text.pdf'));
await writeFile(join(folder,'corrupt.pdf'),'Not a PDF');
await writeFile(join(folder,'00-api-error.txt'),'Correo: error@example.invalid\nExcel');
await writeFile(join(folder,'ignorado.csv'),'Not a CV');await writeFile(join(empty,'ignorado.csv'),'Not a CV');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const width of [320,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();
    const errors=[],calls=[];let active=0,maxActive=0;
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-cv-test-token'));
    await page.route('**/api/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname;
      if(path==='/api/recruitment-profiles/import-cv/') {
        assert.match(request.headers()['content-type'],/application\/json/);
        const data=request.postDataJSON();calls.push(data);assert(!request.postData().includes('%PDF'));
        assert.equal(data.exam,'5');assert.deepEqual(Object.keys(data).sort(),data.commit?['commit','cv_text','exam','expected_cv_hash']:['cv_text','exam']);
        active++;maxActive=Math.max(maxActive,active);
        try {
          if(data.cv_text.includes('error@example.invalid'))return await route.fulfill({status:503,json:{detail:'Fallo ficticio de consulta'}});
          const extra=data.cv_text.match(/extra(\d+)@/),matched=data.cv_text.includes('qa0@example.invalid')||extra;
          const candidate=matched?{id:extra?100+Number(extra[1]):1,name:'Persona Ficticia QA',exam_title:'Postulación QA'}:null;
          if(data.commit) {
            assert.equal(calls.filter(c=>!c.commit).length,24,'all previews must complete before the first write');
            if(extra?.[1]==='20')return await route.fulfill({status:409,json:{detail:'El CV del perfil cambió durante la carga.'}});
            return await route.fulfill({json:{saved:true,unchanged:extra?.[1]==='19',attempt_id:candidate.id}});
          }
          return await route.fulfill({json:{saved:false,match_status:matched?'matched':'unmatched',candidate,candidates:candidate?[candidate]:[],expected_cv_hash:matched?'0'.repeat(64):null}});
        }finally{active--;}
      }
      const data=path==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
        path==='/api/recruitment-exams/'?{results:[{id:5,title:'Postulación QA',public_token:'fake-token'}]}:
        path==='/api/recruitment-profiles/'?{results:[],count:0,page:1,filters:{graded_count:0,top_threshold:null}}:null;
      assert(data,`Unexpected ${path}`);await route.fulfill({json:data});
    });
    await page.goto('http://127.0.0.1:5202/#/examenes/perfiles');
    await page.getByRole('button',{name:'Cargar carpeta de CV',exact:true}).click();
    await page.getByLabel(/^Postulación para la carga de CV/).selectOption('5');
    const picker=page.getByLabel('Seleccionar carpeta de CV',{exact:true});
    assert.equal(await picker.getAttribute('webkitdirectory'),'');
    await picker.setInputFiles(folder);
    await page.getByText('Carga finalizada.',{exact:true}).waitFor();
    await page.getByText('20 perfiles actualizados; 1 CV idénticos; 6 archivos sin asignar o para revisión. 1 archivos de otros tipos omitidos.',{exact:true}).waitFor();
    assert.equal(calls.filter(c=>!c.commit).length,24);assert.equal(calls.filter(c=>c.commit).length,22);assert.equal(maxActive,1);
    assert.equal(calls.filter(c=>c.cv_text.includes('error@example.invalid')).length,1);
    const panel=page.getByRole('region',{name:'Cargar CV por carpeta'});
    assert.equal(await panel.locator('.exam-import-row').count(),27);
    await page.getByLabel(/^Mostrar resultados de CV/).selectOption('pending');
    assert.equal(await panel.locator('.exam-import-row').count(),6);
    const unmatched=panel.locator('.exam-import-row').filter({hasText:'subcarpeta/cv-unmatched.pdf'});
    await unmatched.getByRole('button',{name:'Copiar texto del CV',exact:true}).click();
    assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('cv-missing@example.invalid'));
    await unmatched.getByText('Ver texto extraído del CV',{exact:true}).click();
    assert((await unmatched.getByLabel('Texto extraído del CV',{exact:true}).inputValue()).includes('Excel y Python'));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await picker.scrollIntoViewIfNeeded();await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-cv-folder-${width}.png`});
    // Different CV versions for the same profile must both remain unassigned.
    const before=calls.length;
    await page.getByLabel('Seleccionar CV sueltos PDF o TXT',{exact:true}).setInputFiles([join(pdfs,'cv-matched.pdf'),join(pdfs,'cv-duplicate.pdf')]);
    await page.getByText('Carga finalizada.',{exact:true}).waitFor();
    await page.getByText('0 perfiles actualizados; 0 CV idénticos; 2 archivos sin asignar o para revisión. 0 archivos de otros tipos omitidos.',{exact:true}).waitFor();
    assert.equal(calls.length,before+2);assert.equal(calls.slice(before).filter(c=>c.commit).length,0);
    assert.equal(await panel.getByText('Varios CV de esta carpeta coinciden con el mismo perfil',{exact:true}).count(),2);
    const now=calls.length;await picker.setInputFiles(empty);
    await page.getByText('La selección no contiene CV en PDF o TXT.',{exact:true}).waitFor();assert.equal(calls.length,now);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,pdfTextLocal:true,over20:true,nested:true,automaticUnique:true,noBinaryUpload:true,unmatchedCopy:true,duplicatesNotOverwritten:true,continueWithoutRetry:true,overflow:false}));
    await context.close();
  }
}finally{await browser.close();await rm(fixture,{recursive:true,force:true});}
