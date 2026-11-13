const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert=require('assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});
for(const width of [320,390,1440]){
 const p=await b.newPage({viewport:{width,height:900}});let scanned=0;
 const image=Buffer.from(await p.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;c.getContext('2d').fillStyle='white';c.getContext('2d').fillRect(0,0,600,400);c.getContext('2d').fillStyle='black';c.getContext('2d').fillRect(100,90,360,220);return c.toDataURL('image/jpeg').split(',')[1]}),'base64');
 await p.route('http://127.0.0.1:47631/scan',r=>{scanned++;return r.fulfill({status:200,contentType:'image/jpeg',body:image,headers:{'access-control-allow-origin':'*'}})});
 await p.route('**/api/**',r=>{if(r.request().url().includes('extract-identity'))return r.fulfill({json:{given_names:'Ana',paternal_surname:'Pérez',maternal_surname:'López',birth_date:'1995-01-01'}});return r.fulfill({json:{team:'Equipo',tournament:'Liga',terms:['Compromiso ficticio.']}})});
 await p.goto((process.env.TEST_ENROLLMENT_ORIGIN || 'http://127.0.0.1:5218') + '/#/inscripcion/prueba');await p.getByText('Compromiso ficticio.').waitFor();await p.locator('[data-enrollment-field="accepted_terms_top"] input').check();await p.getByRole('button',{name:'Aceptar y continuar'}).click();
 await p.getByRole('button',{name:'Escanear INE'}).click();await p.getByRole('dialog',{name:'Recortar INE'}).waitFor();await p.waitForTimeout(400);assert(Number(await p.getByLabel('Borde izquierdo').inputValue())>0);const previous=Number(await p.getByLabel('Borde izquierdo').inputValue());await p.getByLabel('Borde izquierdo').fill(String(previous+1));assert.equal(Number(await p.getByLabel('Borde izquierdo').inputValue()),previous+1);await p.getByRole('button',{name:'Girar 90°'}).click();await p.waitForFunction(()=>document.querySelector('.identity-crop-image img')?.naturalWidth===400);await p.getByRole('button',{name:'Usar recorte'}).click();await p.getByAltText('INE frente adjunta').waitFor();assert((await p.getByAltText('INE frente adjunta').evaluate(e=>e.naturalWidth))<600);assert.equal(scanned,1);
 await p.locator('[data-enrollment-field=player_photo] input[type=file]').setInputFiles({name:'foto.jpg',mimeType:'image/jpeg',buffer:image});await p.getByRole('button',{name:'Procesar datos del INE'}).click();await p.getByRole('heading',{name:'Selfie y datos del jugador'}).waitFor();assert.equal(await p.locator('input[name=given_names]').inputValue(),'Ana');assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('PASS',width);await p.close();
}await b.close()})().catch(e=>{console.error(e);process.exit(1)});


