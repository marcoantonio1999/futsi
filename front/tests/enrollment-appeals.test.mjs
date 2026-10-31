import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:'export { SanctionActions, SanctionAppealDetails } from "./src/features/enrollments/SanctionAppeal"; export { SanctionBadge } from "./src/features/enrollments/SanctionBadge";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'}});
const loaded={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const row={id:1,player_name:'Jugador de prueba',status:'active',payment_required:true,appeal_status:'none'};
test('appeals, administrator decisions and payment actions remain separate',()=>{
  const render=(r,admin)=>renderToStaticMarkup(React.createElement(loaded.exports.SanctionActions,{row:r,token:'fixture',admin,onSaved:()=>{}}));
  assert.match(render(row,true),/Apelar sanción/);assert.match(render(row,true),/Registrar folio de pago/);
  assert.doesNotMatch(render(row,false),/Registrar folio/);
  assert.match(render({...row,appeal_status:'pending'},true),/Aceptar apelación/);
  assert.match(render({...row,appeal_status:'pending'},true),/No aceptar apelación/);
  assert.doesNotMatch(render({...row,appeal_status:'accepted',payment_folio:'123'},true),/Aceptar apelación|Registrar folio/);
});
test('payment pending is printable and private letters load on explicit request only',()=>{
  const badge=renderToStaticMarkup(React.createElement(loaded.exports.SanctionBadge,{sanctions:[{id:1,status:'awaiting_payment',starts_on:'2026-10-01',ends_on:'2026-10-10'}]}));
  assert.match(badge,/SANCIONADO/);assert.match(badge,/Pago pendiente/);
  const source=readFileSync('src/features/enrollments/SanctionAppeal.tsx','utf8');
  assert.match(source,/<CameraCapture embedded selfie=\{false\}/);assert.match(source,/onClick=\{\(\)=>setCameraOpen\(true\)\}/);assert.match(source,/compressEnrollmentPhoto/);
  assert.match(source,/submitDisabled=\{cameraOpen\|\|compressing\}/);
  assert.match(source,/<div hidden=\{cameraOpen\}>/);
  assert.match(source,/fetchEnrollmentDocument/);assert.match(source,/URL.revokeObjectURL/);
  assert.match(readFileSync('src/features/enrollments/fetchEnrollmentDocument.ts','utf8'),/Authorization: 'Token ' \+ token/);
  assert.doesNotMatch(source,/setInterval|service_role|supabase.co/);
  const table=readFileSync('src/features/enrollments/DisciplinaryRecords.tsx','utf8');
  assert.match(table,/<th>Apelación<\/th><th>Pago<\/th>/);
});

test('embedded camera stays in the existing modal and releases the stream on close',()=>{
  const source=readFileSync('src/features/enrollments/CameraCapture.tsx','utf8');
  assert.match(source,/navigator.mediaDevices.getUserMedia/);
  assert.match(source,/audio: false/);assert.match(source,/selfie \? "user" : "environment"/);
  assert.match(source,/embedded \? "enrollment-camera-inline" : "enrollment-camera-overlay"/);
  assert.match(source,/stream\?\.getTracks\(\).forEach\(track => track.stop\(\)\)/);
  assert.match(source,/event.stopPropagation\(\)/);
});

test('payment folio is an explicit visible text field styled inside the portal dialog',()=>{
  const source=readFileSync('src/features/enrollments/SanctionAppeal.tsx','utf8');
  const css=readFileSync('src/features/enrollments/enrollmentAdmin.css','utf8');
  assert.match(source,/<Label className="sanction-payment-field">Folio de pago<Input type="text" name="folio" required/);
  assert.match(source,/placeholder="Ej. PAGO-000123"/);
  assert.match(css,/\.tournament-dialog \.sanction-payment-field input\{display:block;box-sizing:border-box;width:100%;min-width:0;min-height:46px/);
  assert.match(css,/border:1px solid #d3ddd6;border-radius:8px/);
});
