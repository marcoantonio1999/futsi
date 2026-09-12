import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryProblem } from '../src/features/voice-agent/veronicaDelivery.ts';
test('billing failure explains cause and next step without asserting missing card', () => {
  const result = deliveryProblem('failed', [131042]);
  assert.equal(result.title, 'No se entregó el mensaje');
  assert.match(result.explanation, /Meta/);
  assert.match(result.action, /administrador/);
  assert.match(result.action, /No repitas/);
});
test('unknown failure has safe fallback', () => {
  assert.match(deliveryProblem('failed', [999]).action, /soporte/);
  assert.doesNotMatch(deliveryProblem('failed', []).explanation, /pagos/);
});
test('uncertain does not claim non-delivery', () => {
  assert.match(deliveryProblem('uncertain').explanation, /No sabemos/);
});
test('success and pending statuses do not show failure', () => {
  for (const status of ['accepted', 'sending', 'sent', 'delivered', 'read', '']) assert.equal(deliveryProblem(status, [131042]), null);
});
