import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:'export { DisciplinaryRecords } from "./src/features/enrollments/DisciplinaryRecords";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',define:{'import.meta.env':'{}'}});
globalThis.window={location:{hostname:'localhost',origin:'http://localhost',protocol:'http:'}};
const loaded={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
test('commission and blacklist render independent sections with all filters',()=>{
  for(const mode of ['commission','blacklist']){
    const html=renderToStaticMarkup(React.createElement(loaded.exports.DisciplinaryRecords,{token:'fixture',mode,revision:0}));
    for(const text of ['Jugador','Sede','Torneo','Equipo','Estado','Desde','Hasta'])assert.ok(html.includes(text));
    assert.ok(html.includes(mode==='commission'?'Comisión disciplinaria':'Lista negra'));
  }
});
test('global exclusions require confirmed identity and reason, never an automatic recommendation',()=>{
  const source=readFileSync(new URL('../src/features/enrollments/DisciplinaryRecords.tsx',import.meta.url),'utf8');
  assert.match(source,/Nombre completo verificado/);assert.match(source,/name="birth_date" type="date" required/);
  assert.match(source,/Confirmo que verifiqué la identidad/);assert.match(source,/minLength=\{10\}/);
  assert.doesNotMatch(source,/setInterval/);
});
