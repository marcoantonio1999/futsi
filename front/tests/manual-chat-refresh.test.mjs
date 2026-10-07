import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the inbox does not periodically reload or reload on focus/visibility', () => {
  const source = readFileSync(new URL('../src/features/voice-agent/VoiceDashboardPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /addEventListener\s*\(\s*["'](?:focus|visibilitychange)["']/);
  assert.doesNotMatch(source, /apiRequest<WhatsAppConversation\[\]>\s*\(\s*["']\/whatsapp-conversations\/\?scope=all/);
  assert.match(source, /setInboxConversations\(data\.whatsappConversations\)/);
});
