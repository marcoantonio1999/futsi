import { useEffect, useState } from 'react';
import { apiFormRequest, apiRequest } from '../../api';
import { inputClass, primaryButtonClass } from './model';

type Config = { configured: boolean; enabled: boolean; filename: string; caption: string; updated_at: string | null };

export function VeronicaAutomaticPdf({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [saved, setSaved] = useState<Config | null>(null);
  const [caption, setCaption] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Config>('/veronica/auto-pdf/', token, { signal: controller.signal })
      .then(c => { setSaved(c); setCaption(c.caption); setEnabled(c.enabled); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [token]);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (file && (!file.name.toLowerCase().endsWith('.pdf') || file.size > 5*1024*1024)) throw new Error('Selecciona un PDF de máximo 5 MB.');
      const form = new FormData();
      form.set('caption', caption); form.set('enabled', String(enabled));
      if (file) form.set('file', file);
      const c = await apiFormRequest<Config>('/veronica/auto-pdf/', token, form);
      setSaved(c); setCaption(c.caption); setEnabled(c.enabled); setFile(null);
      setNotice('Guardado. Se aplicará a las próximas respuestas; no se enviaron mensajes al guardar.');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el PDF.'); }
    finally { setBusy(false); }
  }
  return <section className="comm-panel" aria-label="Configuración del PDF automático">
    <h3>PDF automático</h3>
    <p><strong>{saved?.enabled && saved.configured ? 'Activo' : 'Inactivo'}</strong> · {saved?.filename || 'Sin archivo seleccionado'}</p>
    <p>Se envía una sola vez después de cualquier respuesta a la plantilla de reclutamiento. Cambiar el archivo no vuelve a enviarlo a quienes ya lo recibieron.</p>
    {error && <p className="comm-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <details><summary>{saved?.configured ? 'Cambiar PDF o mensaje' : 'Elegir PDF y configurar'}</summary>
      <label>Elegir otro PDF (máximo 5 MB)<input key={saved?.updated_at || 'initial'} type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setNotice(''); }} /></label>
      {file && <p>Nuevo archivo: <strong>{file.name}</strong>. El archivo actual se conserva hasta guardar.</p>}
      <label>Mensaje que acompaña al PDF<textarea className={inputClass} rows={3} maxLength={1024} value={caption} disabled={busy} onChange={e => setCaption(e.target.value)} /></label>
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={e => setEnabled(e.target.checked)} /> Enviar automáticamente cuando el contacto responda</label>
      <p>El archivo se guarda de forma privada. No es necesario cambiar variables ni volver a desplegar.</p>
      <button className={primaryButtonClass} disabled={busy || !saved || (enabled && !file && !saved.configured)} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar PDF automático'}</button>
    </details>
  </section>;
}
