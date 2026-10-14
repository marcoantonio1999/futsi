import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const bundle=await build({stdin:{contents:'export { SanctionBadge } from "./src/features/enrollments/SanctionBadge"; export { WithdrawalPlayerCard } from "./src/features/enrollments/WithdrawalPlayerCard";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic'});
const loaded={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const sanctions=[{id:1,starts_on:'2026-10-01',ends_on:'2026-10-31',status:'active'}];
test('sanction labels print inclusive end date and indefinite duration without relying on color',()=>{
  const render=value=>renderToStaticMarkup(React.createElement(loaded.exports.SanctionBadge,{sanctions:value}));
  assert.match(render(sanctions),/SANCIONADO/);assert.match(render(sanctions),/31\/10\/2026/);
  assert.match(render([{...sanctions[0],ends_on:null}]),/Sin término/);
  assert.match(render([{...sanctions[0],status:'scheduled'}]),/Sanción desde 01\/10\/2026/);
  assert.equal(render([]),'');assert.doesNotMatch(render(sanctions),/no-print/);
});
test('withdrawal card disables sanctioned selection and explains why',()=>{
  const html=renderToStaticMarkup(React.createElement(loaded.exports.WithdrawalPlayerCard,{player:{id:1,name:'Jugador Ficticio Pérez',has_photo:false,is_delegate:false,can_withdraw:false,sanctions},endpoint:'/local/',selected:false,onChange:()=>{}}));
  assert.match(html,/disabled=""/);assert.match(html,/No puede darse de baja/);assert.match(html,/SANCIONADO/);
});
test('both paper formats include the sanction and remain printable in monochrome',()=>{
  const source=readFileSync('src/features/enrollments/PlayerEnrollment.tsx','utf8');
  const paper=source.slice(source.indexOf('const row = pagePlayers'),source.indexOf('export function EnrollmentDashboard'));
  assert.equal((paper.match(/<SanctionBadge/g)||[]).length,2);
  const css=readFileSync('src/features/enrollments/enrollmentAdmin.css','utf8');
  assert.match(css,/@media print\{\.player-sanction-badge\{color:#000!important/);
});
