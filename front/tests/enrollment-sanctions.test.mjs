import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:'export { NewSanction } from "./src/features/enrollments/NewSanction"; export { EnrollmentDatePicker, EnrollmentDateRangePicker } from "./src/features/enrollments/EnrollmentDatePicker";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'}});
globalThis.window={location:{hostname:'localhost',origin:'http://localhost',protocol:'http:'}};
const loaded={exports:{}};
const requireModule=createRequire(import.meta.url);
new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name.endsWith('.css')?{}:requireModule(name),loaded,loaded.exports);
test('sanction form separates recommendations from freely chosen coordinator duration',()=>{
  const html=renderToStaticMarkup(React.createElement(loaded.exports.NewSanction,{token:'fixture',catalog:{sites:[],teams:[],tournaments:[]}}));
  for(const label of ['Nueva sanción','Jugador','Fecha del incidente','Duración elegida','Días','Semanas','Meses','Años','Elegir periodo (inicio y fin)','Periodo de sanción','Sin fecha de término','Descripción del incidente'])assert.ok(html.includes(label));
  assert.doesNotMatch(html,/El tabulador es orientativo|no está obligado a usar el rango recomendado/);
  assert.match(html,/No ejecuta una baja/);
});
test('new sanctions uses shared mobile navigation and prevents repeated submissions',()=>{
  const dashboard=readFileSync(new URL('../src/features/enrollments/PlayerEnrollment.tsx',import.meta.url),'utf8');
  assert.match(dashboard,/>Sanciones<\/div>/);assert.match(dashboard,/\['commission','Comisión disciplinaria'\],\['sanction-new','Nueva sanción'\]/);
  const form=readFileSync(new URL('../src/features/enrollments/NewSanction.tsx',import.meta.url),'utf8');
  assert.match(form,/request_id:requestId.current/);assert.match(form,/saving.current\|\|loading/);
  assert.doesNotMatch(form,/setInterval/);
});

test('mobile renders native date controls without duplicate hidden values or custom calendar triggers',()=>{
  window.matchMedia=()=>({matches:true});
  try{
    const birth=renderToStaticMarkup(React.createElement(loaded.exports.EnrollmentDatePicker,{label:'Nacimiento',name:'birth_date',value:'2003-07-13',max:'2026-10-15',birthday:true,required:true,onChange:()=>{}}));
    assert.match(birth,/type="date"/);assert.match(birth,/autoComplete="bday"/);assert.match(birth,/max="2026-10-15"/);
    assert.equal((birth.match(/name="birth_date"/g)||[]).length,1);
    assert.doesNotMatch(birth,/enrollment-date-trigger|type="hidden"/);
    const range=renderToStaticMarkup(React.createElement(loaded.exports.EnrollmentDateRangePicker,{label:'Periodo',from:'2026-10-15',to:'2026-10-22',min:'2026-10-14',onChange:()=>{}}));
    assert.equal((range.match(/type="date"/g)||[]).length,2);
    assert.equal((range.match(/name="starts_on"/g)||[]).length,1);
    assert.equal((range.match(/name="ends_on"/g)||[]).length,1);
    assert.match(range,/<input[^>]*min="2026-10-15"[^>]*name="ends_on"/);
    assert.doesNotMatch(range,/enrollment-date-trigger|type="hidden"/);
  }finally{delete window.matchMedia}
});
