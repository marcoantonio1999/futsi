// UI-only regression; fictional profiles and mocked local API, no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const common={email:'qa@example.invalid',phone:'5500000000',exam_id:1,score:9,grading_status:'graded',has_cv:false,has_form:false,matched_keywords:[]};
const profiles=[{...common,id:1,name:'Persona ficticia uno',position:'Business Operations & AI',exam_title:'Business Operations & AI'},
  {...common,id:2,name:'Persona ficticia dos',position:'  BUSINESS   OPERATIONS & AI ',exam_title:'Business Operations & AI'},
  {...common,id:3,name:'Persona ficticia tres',position:'Analista de datos',exam_title:'Evaluación técnica'},
  {...common,id:4,name:'Persona ficticia cuatro',position:'',exam_title:'Entrenador de fútbol'}];
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const width of [320,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-local-ui-token'));
    await page.route('**/api/**',async route=>{
      assert.equal(route.request().method(),'GET');
      const path=new URL(route.request().url()).pathname;
      const data=path==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
        path==='/api/recruitment-exams/'?{results:[]}:
        path==='/api/recruitment-profiles/'?{results:profiles,count:profiles.length,page:1,filters:{graded_count:4,top_threshold:null}}:null;
      assert(data,`Unexpected API ${path}`);await route.fulfill({json:data});
    });
    await page.goto('http://127.0.0.1:5202/#/examenes/perfiles');
    await page.getByText('4 perfiles encontrados',{exact:true}).waitFor();
    const headers=await page.locator('.exam-profile-table th').allTextContents();
    assert.deepEqual(headers,['Persona','Postulación','Calificación','Conocimientos encontrados','Documentación en texto','Perfil']);
    const rows=page.locator(width<=600?'.exam-profile-card':'.exam-profile-table tbody tr');
    assert.equal(await rows.count(),4);
    for(let index=0;index<4;index++) {
      const row=rows.nth(index),postulation=row.locator('.exam-profile-postulation');
      assert.equal(await postulation.count(),1);
      assert.equal(await postulation.locator('strong').textContent(),profiles[index].position.trim()||profiles[index].exam_title);
      assert.equal(await postulation.locator('small').count(),index===2?1:0);
      if(width>600)assert.equal(await row.locator('td').count(),6);
      const box=await row.getByRole('button',{name:'Ver / editar perfil'}).boundingBox();assert(box.height>=44);
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(width<=900) {
      await page.getByRole('button',{name:'Abrir menú de exámenes'}).click();
      await page.getByRole('dialog',{name:'Navegación de exámenes'}).getByRole('button',{name:'Perfiles',exact:true}).click();
      assert.equal(await page.locator('dialog[open]').count(),0);
    }
    await rows.first().scrollIntoViewIfNeeded();
    await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-postulation-column-${width}.png`});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,columns:6,singlePostulation:true,noDuplicateTitle:true,preservedDistinctData:true,overflow:false}));
    await context.close();
  }
}finally{await browser.close();}
