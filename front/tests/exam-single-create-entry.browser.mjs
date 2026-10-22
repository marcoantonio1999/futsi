// UI-only regression: mocked local API, no production writes or AI.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {navigateExamSection} from './exam-admin-navigation.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:5202/';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  for(const width of [320,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-local-ui-token'));
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      const data=path==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
        path==='/api/recruitment-exams/'?{results:[]}:
        path==='/api/recruitment-profiles/'?{results:[],count:0,page:1,filters:{graded_count:0,top_threshold:null}}:null;
      assert(data,`Unexpected API ${path}`);await route.fulfill({json:data});
    });
    await page.goto(base+'#/examenes');
    await page.getByRole('heading',{name:'Mis exámenes',exact:true}).waitFor();
    for(const section of ['Crear examen','Ver evaluaciones','Perfiles','Mis exámenes']) {
      await navigateExamSection(page,section);
      await page.getByRole('heading',{name:section,exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Nuevo examen',exact:true}).count(),0);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width<=900)assert(!(await page.getByRole('dialog',{name:'Navegación de exámenes'}).isVisible()));
      if(section==='Perfiles')await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-no-new-button-${width}.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,redundantButton:false,createSectionWorks:true,overflow:false}));
    await context.close();
  }
} finally {await browser.close();}
