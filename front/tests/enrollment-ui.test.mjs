import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:'export * from "./src/components/ui/enrollment-ui";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic'});
const loaded={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const ui=loaded.exports;
test('shared buttons preserve submit, disabled, accessibility and brand variants',()=>{
 const html=renderToStaticMarkup(React.createElement(ui.Button,{className:'primary',disabled:true,'aria-label':'Guardar'},'Guardar'));
 assert.match(html,/data-slot="button"/);assert.match(html,/data-variant="default"/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/type="button"/);
 const cancel=renderToStaticMarkup(React.createElement(ui.Button,{type:'button',variant:'ghost'},'Cancelar'));assert.match(cancel,/type="button"/);assert.match(cancel,/data-variant="ghost"/);
});
test('cards preserve native form semantics and document fields remain serializable',()=>{
 const html=renderToStaticMarkup(React.createElement(ui.Card,{as:'form',className:'fixture'},React.createElement(ui.Input,{type:'hidden',name:'identity_type',value:'curp'}),React.createElement(ui.NativeSelect,{name:'team',defaultValue:'1'},React.createElement('option',{value:'1'},'Uno'))));
 assert.match(html,/^<form data-slot="card"/);assert.match(html,/name="identity_type"/);assert.match(html,/value="curp"/);assert.match(html,/data-slot="native-select"/);
});
test('screen skin never changes A4 styles and keeps distinct mobile layout',()=>{
 const css=readFileSync(new URL('../src/components/ui/enrollment-ui.css',import.meta.url),'utf8');
 assert.match(css,/@media screen/);assert.doesNotMatch(css,/@media print|@page/);assert.match(css,/min-height:44px/);assert.match(css,/max-width:600px/);
 const calendar=readFileSync(new URL('../src/features/enrollments/EnrollmentDatePicker.tsx',import.meta.url),'utf8');
 assert.match(calendar,/Popover\.Portal container=\{container\}/);assert.doesNotMatch(calendar,/native \|\| forceNative/);
});
