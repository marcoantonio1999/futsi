import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrapPresentationText} from '../src/features/enrollments/disciplinaryImage.ts';
const context={measureText:value=>({width:[...value].length*10})};
test('presentation wraps long names, long words and paragraphs without losing characters',()=>{
 for(const text of ['José Pérez López','Motivo '.repeat(300),'A'.repeat(180),'Primera línea\nSegunda línea','😊 Motivo válido']){
  const lines=wrapPresentationText(context,text,160);
  assert(lines.every(line=>context.measureText(line).width<=160));
  assert.equal(lines.join('').replace(/\s/g,''),text.replace(/\s/g,''));
 }
});
