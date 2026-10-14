import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:'export { NewSanction } from "./src/features/enrollments/NewSanction";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',define:{'import.meta.env':'{}'}});
globalThis.window={location:{hostname:'localhost',origin:'http://localhost',protocol:'http:'}};
const loaded={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
test('sanction form separates recommendations from freely chosen coordinator duration',()=>{
  const html=renderToStaticMarkup(React.createElement(loaded.exports.NewSanction,{token:'fixture',catalog:{sites:[],teams:[],tournaments:[]}}));
  for(const label of ['Nueva sanción','Jugador','Fecha del incidente','Duración elegida','Días','Semanas','Meses','Años','Elegir fecha final','Sin fecha de término','Descripción del incidente'])assert.ok(html.includes(label));
  assert.match(html,/no está obligado a usar el rango recomendado/);
  assert.match(html,/No ejecuta una baja/);
});
test('new sanctions uses shared mobile navigation and prevents repeated submissions',()=>{
  const dashboard=readFileSync(new URL('../src/features/enrollments/PlayerEnrollment.tsx',import.meta.url),'utf8');
  assert.match(dashboard,/>Sanciones<\/div>/);assert.match(dashboard,/>Nueva sanción<\/button>/);
  const form=readFileSync(new URL('../src/features/enrollments/NewSanction.tsx',import.meta.url),'utf8');
  assert.match(form,/request_id:requestId.current/);assert.match(form,/saving.current\|\|loading/);
  assert.doesNotMatch(form,/setInterval/);
});
