import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:'export { SanctionActions, SanctionAppealDetails } from "./src/features/enrollments/SanctionAppeal"; export { SanctionBadge } from "./src/features/enrollments/SanctionBadge";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',define:{'import.meta.env':'{}'}});
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
  assert.match(source,/capture="environment"/);assert.match(source,/compressEnrollmentPhoto/);
  assert.match(source,/Authorization:`Token/);assert.match(source,/URL.revokeObjectURL/);
  assert.doesNotMatch(source,/setInterval|service_role|supabase.co/);
  const table=readFileSync('src/features/enrollments/DisciplinaryRecords.tsx','utf8');
  assert.match(table,/<th>Apelación<\/th><th>Pago<\/th>/);
});
