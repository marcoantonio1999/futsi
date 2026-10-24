import {Fragment, useEffect, useRef, useState} from 'react';
import {Download, X, UserRound} from 'lucide-react';
import {API_URL} from '../../api';
import {disciplinaryImage, presentationData, presentationFields, type PresentationRow} from './disciplinaryImage';
import './disciplinaryPresentation.css';

export function DisciplinaryPresentation({row, token, endpoint, onClose}: {row: PresentationRow; token: string; endpoint: string; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null), photo = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState(''), [loading, setLoading] = useState(Boolean(row.has_photo)), [photoReady, setPhotoReady] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const data = presentationData(row);
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.showModal();
    return () => { document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  useEffect(() => {
    if (!row.has_photo) return;
    let active = true, objectUrl = ''; const controller = new AbortController();
    fetch(`${API_URL}${endpoint}${row.id}/photo/?view=presentation`, {headers: {Authorization: `Token ${token}`}, signal: controller.signal})
      .then(async response => {
        if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('Foto no disponible');
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
      }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [row.id, row.has_photo, endpoint, token]);
  async function download() {
    if (busy || loading) return;
    setBusy(true); setError('');
    try {
      const canvas = disciplinaryImage(data, photoReady ? photo.current : null);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo generar la imagen.')), 'image/png'));
      const downloadUrl = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = downloadUrl; anchor.download = `presentacion-${row.player_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 90)}.png`;
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo descargar la imagen.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="disciplinary-presentation no-print" aria-labelledby="disciplinary-presentation-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="disciplinary-presentation-toolbar"><h2 id="disciplinary-presentation-title">Sancionado</h2><button type="button" onClick={onClose} aria-label="Cerrar presentación"><X size={20}/></button></header>
    <div className="disciplinary-presentation-scroll"><article className="disciplinary-presentation-card" aria-label="Ficha de presentación">
      <div className="disciplinary-presentation-photo">
        {url ? <img ref={photo} src={url} alt={`Foto de ${row.player_name}`} onLoad={() => {setLoading(false); setPhotoReady(true);}} onError={() => {setLoading(false); setPhotoReady(false); setUrl('');}}/> : <UserRound size={100} aria-label={loading ? 'Cargando foto' : 'Foto no disponible'}/>}
      </div>
      <h3>{row.player_name}</h3><dl>{presentationFields(data).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl>
    </article></div>
    <footer className="disciplinary-presentation-footer">
      {!loading && !photoReady && <p role="status">La foto no está disponible; la imagen usará una silueta.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="primary" disabled={loading || busy} onClick={() => void download()}><Download size={18} aria-hidden="true"/>{loading ? 'Cargando foto…' : busy ? 'Generando imagen…' : 'Descargar imagen'}</button>
    </footer>
  </dialog>;
}
