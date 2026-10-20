import {test} from 'node:test';
import assert from 'node:assert/strict';
import {remainingExamSeconds,formatExamCountdown} from '../src/features/exams/examCountdown.ts';
test('counts down to zero and never becomes negative',()=>{
 for(const [elapsed,expected] of [[0,'40:00'],[1,'39:59'],[2399,'00:01'],[2400,'00:00'],[4000,'00:00']]){
  assert.equal(formatExamCountdown(remainingExamSeconds(40,elapsed)),expected);
 }
});
