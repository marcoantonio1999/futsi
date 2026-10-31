import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const fixture=await browser.newPage();await fixture.setContent('<p>Documento ficticio de prueba</p>');const pdf=await fixture.pdf({format:'A4'});
 const image=Buffer.from(await fixture.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;const x=c.getContext('2d');x.fillStyle='#e5f2e9';x.fillRect(0,0,600,400);x.fillStyle='#17523b';x.font='28px Arial';x.fillText('DOCUMENTO FICTICIO',40,180);return c.toDataURL().split(',')[1];}),'base64');await fixture.close();
 for(const width of [320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});const requests=[],posts=[];let release,failSave=true;const hold=new Promise(r=>release=r);let approved=false;
 const docs=['player_photo','ine_front','ine_back','player_signature','identity_document'].map((kind,i)=>({id:11+i,kind}));
 const row={id:1,name:'Jugador de prueba',birth_date:'1990-01-01',team:'Equipo prueba',tournament:'Torneo prueba',phone:'5511111111',phone_secondary:'',guardian_name:'',identity_type:'ine',signed_at:'2026-10-30T18:00:00Z',terms_text:[],documents:docs,is_delegate:false};
 await page.route('**/api/**',async r=>{const req=r.request(),url=new URL(req.url());if(req.method()==='OPTIONS')return r.fulfill({status:204});
 if(req.method()==='POST'){posts.push(req.postDataJSON());if(failSave)return r.fulfill({status:400,json:{detail:'Error de prueba'}});approved=true;return r.fulfill({json:{completed:true}});}
 const match=url.pathname.match(/documents\/(\d+)\//);if(match){const id=Number(match[1]);requests.push(id);if(id===14)await hold;return r.fulfill({contentType:id===15?'application/pdf':'image/png',body:id===15?pdf:image});}
 if(url.searchParams.has('validation_count_only'))return r.fulfill({json:{pending_validation_count:approved?0:1}});
 if(url.pathname.endsWith('/catalog/'))return r.fulfill({json:{sites:[],tournaments:[],teams:[]}});
 return r.fulfill({json:{results:approved?[]:[row],count:approved?0:1}});
 });
 await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/validate');await page.getByRole('button',{name:'Revisar inscripción',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.enrollment-approval-docs article').length===5);
 await page.waitForTimeout(100);assert.deepEqual([...requests].sort((a,b)=>a-b),[11,12,13,14,15]);
 assert.equal(await page.locator('.enrollment-approval input[type=checkbox]').count(),0);assert.equal(await page.locator('.enrollment-approval-docs button').count(),0);
 const approve=page.getByRole('button',{name:'Validar inscripción',exact:true});assert(await approve.isDisabled());release();await approve.waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Validar inscripción').disabled);
 assert.equal(await page.locator('.enrollment-approval-docs img').count(),5);assert.equal(await page.locator('.enrollment-pdf-pages img').count(),1);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await approve.boundingBox()).height>=44);
 if(process.env.TEST_OUTPUT)await page.screenshot({path:`${process.env.TEST_OUTPUT}/validar-galeria-${width}.png`,fullPage:true});
 await approve.click();await page.getByRole('alert').filter({hasText:'Error de prueba'}).waitFor();assert.equal(requests.length,5);failSave=false;await approve.click();await page.getByText('Inscripción validada. Ya puede aparecer en la sábana.',{exact:true}).waitFor();
 assert.deepEqual(posts[1],{confirmed:true,documents_reviewed:[...posts[1].documents_reviewed]});assert.deepEqual([...posts[1].documents_reviewed].sort((a,b)=>a-b),[11,12,13,14,15]);
 console.log({width,gallery:true,noCheckboxes:true,singleApproval:true,pdfVisible:true,noOverflow:true,noRealWrites:true});await page.close();
 }
 const failed=await browser.newPage();await failed.route('**/api/**',r=>{const url=new URL(r.request().url());if(url.pathname.includes('/documents/'))return r.fulfill({status:503});if(url.pathname.endsWith('/catalog/'))return r.fulfill({json:{sites:[],tournaments:[],teams:[]}});return r.fulfill({json:{pending_validation_count:1,count:1,results:[{id:1,name:'Prueba',birth_date:'1990-01-01',identity_type:'ine',signed_at:'2026-10-30T18:00:00Z',terms_text:[],documents:['player_photo','ine_front','ine_back','player_signature'].map((kind,i)=>({id:i+1,kind}))}]}});});
 await failed.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/validate');await failed.getByRole('button',{name:'Revisar inscripción'}).click();await failed.getByRole('alert').first().waitFor();assert(await failed.getByRole('button',{name:'Validar inscripción',exact:true}).isDisabled());console.log('Unavailable documents block approval without checkboxes');await failed.close();
}finally{await browser.close();}
