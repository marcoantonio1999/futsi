import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bundle = await build({stdin:{contents:'export { WhatsAppWeeklyStatsPanel } from "./src/features/voice-agent/WhatsAppWeeklyStatsPanel";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},define:{'import.meta.env':'{}'}});
const loaded={exports:{}};
globalThis.window={location:{hostname:'localhost',origin:'http://localhost',protocol:'http:'}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),loaded,loaded.exports);
const {WhatsAppWeeklyStatsPanel}=loaded.exports;
const render=days=>renderToStaticMarkup(React.createElement(WhatsAppWeeklyStatsPanel,{token:'local-test-only',value:null,showClassifications:false,periodDays:days,periodStart:'2026-10-08',onOpenConversation:()=>{}}));
test('three-day controls use the selected dates, not the containing week',()=>{
 const html=render(3);
 assert.match(html,/value="2026-10-08"/);
 assert.match(html,/2026-10-10/);
 assert.match(html,/Periodo anterior/);
 assert.doesNotMatch(html,/Semana del/);
});
test('two-day controls include two dates',()=>{
 assert.match(render(2),/2026-10-09/);
});
