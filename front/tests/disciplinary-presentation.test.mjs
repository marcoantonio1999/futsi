import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrapPresentationText, presentationData, presentationFields} from '../src/features/enrollments/disciplinaryImage.ts';
const context={measureText:value=>({width:[...value].length*10})};
test('presentation wraps long names, long words and paragraphs without losing characters',()=>{
 for(const text of ['José Pérez López','Motivo '.repeat(300),'A'.repeat(180),'Primera línea\nSegunda línea','😊 Motivo válido']){
  const lines=wrapPresentationText(context,text,160);
  assert(lines.every(line=>context.measureText(line).width<=160));
  assert.equal(lines.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
});
test('modal and image share tournament, sanction, reason, period, server status and registration date',()=>{
 const row={id:1,player_name:'José Pérez',reason:'Decisión registrada',offense:'Falta',tournament:'Torneo A',status:'active',created_at:'2026-10-23',starts_on:'2026-10-25',ends_on:'2026-11-15'};
 const fields=presentationFields(presentationData(row));
 assert.deepEqual(fields,[['Torneo','Torneo A'],['Sanción','Falta'],['Motivo','Decisión registrada'],['Periodo','25/10/2026 – 15/11/2026'],['Estado','Vigente'],['Fecha','23/10/2026']]);
 for(const [status,label] of Object.entries({expired:'Cumplida',awaiting_payment:'Pago pendiente',scheduled:'Programada',indefinite:'Sin término',revoked:'Retirada'}))assert.equal(presentationData({...row,status}).status,label);
 assert.equal(presentationData({...row,ends_on:null}).period,'25/10/2026 – Sin término');
 assert.equal(presentationData({...row,starts_on:null,ends_on:null}).period,'Inicio no registrado – Sin término');
 assert.equal(presentationData({...row,status:'unknown'}).status,'Estado no especificado');
});
