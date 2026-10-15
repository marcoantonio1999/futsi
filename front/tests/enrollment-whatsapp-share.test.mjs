import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('enrollment and withdrawal sharing retains its label and URL with a decorative WhatsApp brand icon', () => {
  const page = readFileSync('src/features/enrollments/PlayerEnrollment.tsx', 'utf8');
  const icon = readFileSync('src/features/enrollments/WhatsAppIcon.tsx', 'utf8');
  const css = readFileSync('src/features/enrollments/enrollmentAdmin.css', 'utf8');
  assert.match(page, /className="enrollment-whatsapp-share" href=\{"https:\/\/wa.me\/\?text="/);
  assert.match(page, /<WhatsAppIcon \/><span>Compartir por WhatsApp<\/span>/);
  assert.match(icon, /aria-hidden="true" focusable="false"/);
  assert.match(css, /a\.enrollment-whatsapp-share\{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px/);
  assert.match(css, /\.enrollment-whatsapp-icon\{display:block;flex:0 0 22px/);
});
