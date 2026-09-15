// Every request is local mock data. No provider access, credentials or messages.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import '../src/features/voice-agent/communications.css';
import { ConnectionsPanel } from '../src/features/voice-agent/ConnectionsPanel';
import { CommunicationsNav } from '../src/features/voice-agent/CommunicationsNav';
import { VeronicaOnlyContext } from '../src/features/voice-agent/CommunicationsAccess';
if (!import.meta.env.DEV) throw new Error('Development only');
const vero = new URLSearchParams(location.search).get('vero') === '1';
window.fetch = async input => {
  const url = new URL(String(input), location.origin);
  const kind = url.pathname.includes('/veronica/') ? 'veronica' : 'academy';
  if (vero && kind !== 'veronica') throw new Error('Unexpected academy request for Vero');
  if (url.pathname.endsWith('/connections/')) return Response.json({ connections: (kind === 'veronica' ? ['Verónica'] : ['Franco Academia', 'Liga Franco', 'Academia principal']).map((label, i) => ({ channel: `${kind}-${i}`, label, phone_number: `+52 55 0000 000${i}`, phone_number_id: '123456789', waba_id: '987654321', verified_name: label, verified: i !== 2, status: i === 2 ? '' : 'CONNECTED', quality: i ? 'UNKNOWN' : 'GREEN', name_status: 'APPROVED', detail: i === 2 ? 'No pudimos verificar el número con Dualhook. Intenta actualizar más tarde.' : '', checked_at: new Date().toISOString() })) });
  if (url.pathname.endsWith('/catalog/')) return Response.json({ templates: ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED'].map((status, i) => ({ name: `${kind === 'veronica' ? 'reclutamiento' : 'invitacion'}_${i+1}`, status, language: 'es', category: 'MARKETING', text: 'Hola, {{1}}. Te compartimos información.\nResponde si te interesa.', rejected_reason: status === 'REJECTED' ? 'Revisa el formato de las variables.' : '' })), next_cursor: '' });
  return Response.json({ detail: 'Blocked by fixture' }, { status: 400 });
};
createRoot(document.getElementById('root')!).render(<VeronicaOnlyContext.Provider value={vero}><main className="communications" style={{ maxWidth: 1200, margin: 'auto', padding: 24 }}><p>SIMULACIÓN · sin envíos</p><CommunicationsNav section="connections" canReview compact onSelect={() => {}} /><ConnectionsPanel token="mock" veronicaOnly={vero} /></main></VeronicaOnlyContext.Provider>);
