import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const bundle = await build({ entryPoints: ['src/features/voice-agent/contactAudit.ts'], bundle: true, write: false, format: 'esm', define: { 'import.meta.env.VITE_API_URL': '"/api"' } });
const { loadExistingContactAudit, classificationGroup } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('does not classify former or uncertain clients as current clients', () => {
  assert.equal(classificationGroup('Alumno confirmado'), 'current_client');
  assert.equal(classificationGroup('Alumno probable'), 'ambiguous');
  assert.equal(classificationGroup('Baja confirmada'), 'other');
  assert.equal(classificationGroup('Sin clasificar'), 'unclassified');
});

test('existing API counts include every category and respect site scope', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url, 'http://localhost'); calls.push(parsed);
    let body;
    if (parsed.pathname.endsWith('/whatsapp-conversations/channels/')) body = [{ business_address: 'meta:1', site: 27 }, { business_address: 'meta:2', site: 42 }];
    else if (parsed.pathname.endsWith('/whatsapp-bulk/channels/')) body = { channels: [{ channel: 'meta:1', contact_directory: 'franco' }, { channel: 'meta:2', contact_directory: 'club' }] };
    else {
      assert.equal(parsed.searchParams.get('channel'), 'meta:1');
      assert.equal(parsed.searchParams.get('outreach'), 'all');
      const label = parsed.searchParams.get('relationship');
      body = { total: label === 'Prospecto' ? 5 : label === 'Baja confirmada' ? 3 : 10, dataset_total: 10, facets: { relationship: ['Prospecto', 'Baja confirmada'] } };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const result = await loadExistingContactAudit('test', 'scope=all&site=27', new AbortController().signal);
    assert.equal(result.total, 10);
    assert.equal(result.categories.prospect, 5);
    assert.equal(result.categories.other, 3);
    assert.equal(result.categories.unclassified, 2);
    assert.equal(Object.values(result.categories).reduce((a,b) => a+b, 0), 10);
    assert.equal(calls.length, 5);
  } finally { globalThis.fetch = original; }
});
