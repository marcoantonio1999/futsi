import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
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
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  function chooseFile(files: FileList | null) {
    if (busy || !files?.length) return;
    setNotice('');
    if (files.length !== 1 || !files[0].name.toLowerCase().endsWith('.pdf') || files[0].size > 5*1024*1024) {
      setError('Elige un solo archivo PDF de máximo 5 MB.');
      return;
    }
    setFile(files[0]); setError('');
  }
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
    {error && <p className="comm-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <details><summary>{saved?.configured ? 'Cambiar PDF o mensaje' : 'Elegir PDF y configurar'}</summary>
      <input ref={picker} className="vero-pdf-input" type="file" accept=".pdf,application/pdf" tabIndex={-1} aria-hidden="true" disabled={busy} onChange={e => { chooseFile(e.target.files); e.target.value = ''; }} />
      <div className={`vero-pdf-drop${dragging ? ' is-dragging' : ''}${busy ? ' is-disabled' : ''}`} role="group" aria-label="Cargar PDF automático"
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (!busy) setDragging(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={e => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files); }}>
        <Upload size={30} aria-hidden="true" />
        <strong>{dragging ? 'Suelta el PDF aquí' : 'Arrastra tu PDF aquí'}</strong>
        <span>Un archivo PDF · máximo 5 MB</span>
        <button type="button" className="vero-pdf-choose" disabled={busy} onClick={() => picker.current?.click()}><Upload size={18} aria-hidden="true" />Elegir PDF</button>
      </div>
      {file && <div className="vero-pdf-selected" role="status"><FileText size={26} aria-hidden="true" /><div><strong>{file.name}</strong><small>{(file.size / 1024).toLocaleString('es-MX', { maximumFractionDigits: 0 })} KB · Listo para guardar</small></div><button type="button" disabled={busy} aria-label="Quitar PDF seleccionado" onClick={() => setFile(null)}><X size={20} /></button></div>}
      {file && <small>El PDF actual se reemplazará únicamente al guardar.</small>}
      <label>Mensaje que acompaña al PDF<textarea className={inputClass} rows={3} maxLength={1024} value={caption} disabled={busy} onChange={e => setCaption(e.target.value)} /></label>
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={e => setEnabled(e.target.checked)} /> Enviar automáticamente cuando el contacto responda</label>
      <p>El archivo se guarda de forma privada. No es necesario cambiar variables ni volver a desplegar.</p>
      <button className={primaryButtonClass} disabled={busy || !saved || (enabled && !file && !saved.configured)} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar PDF automático'}</button>
    </details>
  </section>;
}
