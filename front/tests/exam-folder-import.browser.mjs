// Local-only UI regression. Fictional data, mocked API, no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {navigateExamSection} from './exam-admin-navigation.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=await mkdtemp(join(tmpdir(),'exam-folder-qa-'));
const formats=join(fixture,'formatos'),other=join(fixture,'sin-formatos');
await mkdir(join(formats,'subcarpeta'),{recursive:true});await mkdir(other);
for(let i=0;i<21;i++)await writeFile(join(formats,`${String(i).padStart(2,'0')}.TXT`),`nombre: Persona ficticia ${i}\ncorreo: qa${i}@example.invalid`);
await writeFile(join(formats,'subcarpeta','00.TXT'),'nombre: Otro candidato ficticio\nfallo: HTTP de prueba');
await writeFile(join(formats,'vacio.txt'),'');
await copyFile('C:/Users/daniel/Documents/marco/mexprod/tmp/pdfs/qa-empleo-perfiles.pdf',join(formats,'subcarpeta','formato.PDF'));
await writeFile(join(formats,'ignorado.csv'),'No es un formato');
await writeFile(join(other,'ignorado.md'),'Sin PDF ni TXT');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const width of [320,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
    const errors=[],requests=[];let active=0,maxActive=0;
    const candidate={id:1,name:'Persona ficticia',email:'qa@example.invalid',exam_title:'Examen QA'};
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-local-ui-token'));
    await page.route('**/api/**',async route=>{
      const request=route.request(),path=new URL(request.url()).pathname;
      if(path==='/api/recruitment-profiles/import/') {
        assert.match(request.headers()['content-type'],/application\/json/);
        const body=request.postDataJSON();requests.push(body);
        assert(!request.postData().includes('%PDF'));assert.equal(body.file,undefined);
        active++;maxActive=Math.max(maxActive,active);
        try {
          if(body.form_text.includes('HTTP de prueba'))await route.fulfill({status:503,json:{detail:'Fallo individual de prueba'}});
          else await route.fulfill({json:{match_status:'matched',candidate,candidates:[candidate]}});
        } finally {active--;}
        return;
      }
      const data=path==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
        path==='/api/recruitment-exams/'?{results:[]}:
        path==='/api/recruitment-profiles/'?{results:[],count:0,page:1,filters:{graded_count:0,top_threshold:null}}:null;
      assert(data,`Unexpected API ${path}`);await route.fulfill({json:data});
    });
    await page.goto('http://127.0.0.1:5202/#/examenes');
    await page.getByRole('heading',{name:'Mis exámenes',exact:true}).waitFor();
    await navigateExamSection(page,'Perfiles');
    await page.getByRole('button',{name:'Cargar formatos de empleo',exact:true}).click();
    const folder=page.getByLabel('Seleccionar carpeta de formatos',{exact:true});
    assert.equal(await folder.getAttribute('webkitdirectory'),'');
    await folder.setInputFiles(formats);
    await page.getByText('Formatos revisados: 24 de 24. Archivos de otros tipos omitidos: 1.',{exact:true}).waitFor();
    await page.getByText('Lectura terminada.',{exact:false}).waitFor();
    assert.equal(await page.locator('.exam-import-row').count(),24);
    assert.equal(requests.length,23);assert(requests.every(r=>!r.commit));
    assert.equal(requests.filter(r=>r.form_text.includes('HTTP de prueba')).length,1);
    assert(requests.some(r=>r.form_fields.telefono==='55 0012 3456'));
    assert.equal(maxActive,1);
    assert.equal(await page.locator('.exam-import-row h3').filter({hasText:/subcarpeta\/00.TXT/}).count(),1);
    assert.equal(await page.locator('.exam-import-row .exam-error').count(),2);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const box=await folder.boundingBox();assert(box.height>=44);
    await folder.scrollIntoViewIfNeeded();
    await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-folder-import-${width}.png`});
    await page.getByRole('button',{name:'Guardar coincidencias revisadas',exact:true}).click();
    await page.getByText('22 formato(s) vinculados.',{exact:false}).waitFor();
    assert.equal(requests.filter(r=>r.commit).length,22);
    // A folder with only unsupported files makes no matching requests.
    const before=requests.length;await folder.setInputFiles(other);
    await page.getByText('No se encontraron formatos PDF o TXT en la selección.',{exact:true}).waitFor();
    assert.equal(requests.length,before);
    // Multiple loose files remain available, including re-selecting the same files.
    const loose=page.getByLabel('Seleccionar formatos PDF o TXT',{exact:true});
    for(let i=0;i<2;i++) {
      await loose.setInputFiles([join(formats,'00.TXT'),join(formats,'01.TXT')]);
      await page.getByText('Formatos revisados: 2 de 2. Archivos de otros tipos omitidos: 0.',{exact:true}).waitFor();
      await page.getByText('Lectura terminada.',{exact:false}).waitFor();
    }
    assert.equal(requests.length,before+4);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,folder:true,nested:true,pdfAndTxt:true,over20:true,continueOnError:true,explicitSave:true,noOverflow:true}));
    await context.close();
  }
}finally{await browser.close();await rm(fixture,{recursive:true,force:true});}
