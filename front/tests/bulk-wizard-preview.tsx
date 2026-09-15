// Isolated UI fixture: every fetch is intercepted; no backend/provider requests.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { BulkTemplatesPanel } from '../src/features/voice-agent/BulkTemplatesPanel';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const kind = new URLSearchParams(location.search).get('kind') === 'veronica' ? 'veronica' : 'academy';
const jobs: any[] = [];
const template = { name: 'invitacion_temporada', language: 'es', category: 'MARKETING', text: '¡Hola, {{1}}! ⚽ Te invitamos a conocer nuestros entrenamientos. Responde ME INTERESA para recibir información.\n\nSi prefieres no recibir más invitaciones, avísanos por aquí.', sendable: true, parameters: [{ key: 'body:1', label: 'Nombre del destinatario', contact_name: true }] };
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  const op = url.pathname.split('/').filter(Boolean).at(-1);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const channel = url.searchParams.get('channel') || body.channel || 'demo-franco';
  if (op === 'channels') return Response.json({ channels: kind === 'veronica' ? [{ channel: 'demo-vero', label: 'Verónica · prueba' }] : [{ channel: 'demo-franco', label: 'Franco Academia · prueba' }, { channel: 'demo-liga', label: 'Liga Franco · prueba' }] });
  if (op === 'catalog') return Response.json({ templates: channel === 'demo-liga' ? [] : [template], next_cursor: '' });
  if (op === 'list') return Response.json({ jobs: jobs.filter(j => j.channel === channel), has_more: false });
  if (op === 'import') {
    const form = init?.body as FormData;
    const phones = form.has('file') ? ['5511111111', '5522222222'] : String(form.get('text') || '').split(/[\s,]+/).filter(p => /^\d{10}$/.test(p));
    return Response.json({ phones: [...new Set(phones)], count: new Set(phones).size, names: phones.length ? { [phones[0]]: 'Santiago (simulación)' } : {}, duplicates: phones.length-new Set(phones).size, invalid: [] });
  }
  if (op === 'create') {
    let job = jobs.find(j => j.id === body.request_id);
    if (!job) {
      job = { id: body.request_id, channel, title: body.name, template, status: 'draft', detail: '', created_at: new Date().toISOString(), heartbeat_at: null, percent: 0, processed: 0, total: body.phones.length, counts: { pending: body.phones.length }, quote: { total: (body.phones.length*.0305).toFixed(4), unit: '.0305', currency: 'USD', category: 'MARKETING', note: 'Estimación de prueba. No incluye impuestos ni cargos del proveedor.', verified_on: '2026-09-14', source: 'https://whatsappbusiness.com/products/platform-pricing/' }, recipients: body.phones.map((phone: string, id: number) => ({ id, phone, name: body.names[phone], status: 'pending', detail: '' })), has_more: false };
      jobs.unshift(job);
    }
    return Response.json(job);
  }
  const job = jobs.find(j => j.id === (body.id || url.searchParams.get('id')));
  if (op === 'detail' && job) return Response.json(job);
  if (op === 'start' && job) {
    job.status = 'running';
    setTimeout(() => { job.status = 'completed'; job.processed = job.total; job.percent = 100; job.counts = { delivered: job.total }; job.recipients.forEach((r: any) => { r.status = 'delivered'; r.detail = 'Solo simulación'; }); }, 6000);
    return Response.json(job);
  }
  if (op === 'cancel' && job) { job.status = 'cancelled'; return Response.json(job); }
  return Response.json({ detail: 'Solicitud bloqueada por la prueba local' }, { status: 400 });
};
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1100, margin: 'auto', padding: 24 }}><p style={{ marginBottom: 16 }}>SIMULACIÓN · sin envíos ni cargos</p><BulkTemplatesPanel token="mock" kind={kind} /></main>);
