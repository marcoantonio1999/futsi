import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Trash2, X } from "lucide-react";
import { apiRequest } from "../../api";
import type { Student, StudentDeletionConfirmation, StudentDeletionPreview, StudentDeletionResult } from "../../types";

export function StudentDeleteDialog({ student, token, onClose, onDelete }: {
  student: Student; token: string; onClose: () => void;
  onDelete: (id: number, confirmation: StudentDeletionConfirmation) => Promise<StudentDeletionResult>;
}) {
  return <AcademyDeleteDialog record={student} kind="student" token={token} onClose={onClose} onDelete={onDelete} />;
}

type DeletionPreview = Pick<StudentDeletionPreview, "full_name" | "items" | "file_count" | "confirmation_token"> & { students?: { id: number; full_name: string }[] };

export function AcademyDeleteDialog({ record, kind, token, onClose, onDelete }: {
  record: { id: number; full_name: string; site_name?: string }; kind: "student" | "guardian" | "tournament"; token: string; onClose: () => void;
  onDelete: (id: number, confirmation: StudentDeletionConfirmation) => Promise<StudentDeletionResult>;
}) {
  const isGuardian = kind === "guardian";
  const isTournament = kind === "tournament";
  const noun = isTournament ? "torneo" : isGuardian ? "tutor" : "alumno";
  const collection = isTournament ? "tournaments" : isGuardian ? "guardians" : "students";
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [name, setName] = useState("");
  const [cleanup, setCleanup] = useState<StudentDeletionResult | null>(null);
  const [completed, setCompleted] = useState(false);
  const successButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => { if (completed) successButton.current?.focus(); }, [completed]);

  async function review() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setName("");
    try { setPreview(await apiRequest<DeletionPreview>(`/${collection}/${record.id}/deletion-preview/`, token)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudieron consultar los datos asociados."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function remove() {
    if (inFlight.current || !preview || name.trim() !== preview.full_name.trim()) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await onDelete(record.id, { confirmation_token: preview.confirmation_token, confirmation_name: name.trim() });
      if (result.cleanup_pending) setCleanup(result);
      else setCompleted(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : `No se pudo eliminar al ${noun}.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function retryFiles() {
    if (!cleanup || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await apiRequest<StudentDeletionResult>(`/${collection}/deletion-cleanup/`, token, { method: "POST", body: JSON.stringify({ deletion_id: cleanup.deletion_id }) });
      if (result.cleanup_pending) setCleanup(result);
      else setCompleted(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar el borrado de archivos."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="student-enrollment student-delete-dialog" aria-labelledby="student-delete-title" aria-describedby="student-delete-detail" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <button type="button" className="student-delete-close" aria-label={completed ? "Cerrar confirmación" : "Cerrar advertencia de eliminación"} onClick={onClose} disabled={busy}><X size={18} /></button>
    {completed ? <>
      <div className="student-delete-symbol student-delete-success"><CheckCircle2 size={26} /></div>
      <div role="status">
        <h2 id="student-delete-title">{isTournament ? "Torneo eliminado correctamente" : isGuardian ? "Tutor eliminado correctamente" : "Alumno eliminado correctamente"}</h2>
        <p className="student-delete-name">{record.full_name}</p>
        <p id="student-delete-detail">{isTournament ? "Se eliminó el torneo y sus datos asociados. Los alumnos y tutores siguen en la academia." : isGuardian ? "Se eliminaron su ficha, los alumnos a su cargo y los datos asociados." : "Se eliminaron su ficha y sus datos asociados."}</p>
      </div>
      <div className="student-actions"><button ref={successButton} type="button" className="student-button primary" onClick={onClose}>Entendido</button></div>
    </> : <>
    <div className="student-delete-symbol">{preview ? <AlertTriangle size={24} /> : <Trash2 size={24} />}</div>
    <h2 id="student-delete-title">{cleanup ? "Falta borrar archivos" : preview ? (isTournament ? "Eliminar torneo e historial" : isGuardian ? "Eliminar tutor, alumnos e historial" : "Eliminar alumno e historial") : isTournament ? "¿Eliminar este torneo?" : `¿Eliminar a este ${noun}?`}</h2>
    <p className="student-delete-name">{record.full_name}</p><p className="student-hint">{record.site_name}</p>
    <p id="student-delete-detail">{cleanup
      ? `La ficha y el historial ya se eliminaron. Quedan ${cleanup.cleanup_pending} archivos pendientes por un error del almacenamiento. Puedes reintentar sin repetir el borrado del registro.`
      : preview
        ? "Esta eliminación es definitiva. También desaparecerán los siguientes registros y cambiarán los totales de cobranza, pagos y asistencias."
        : isTournament ? "También se eliminarán sus equipos, inscripciones, partidos y los cargos, pagos y asistencias vinculados al torneo. Revisa el detalle antes de continuar." : isGuardian ? "Si tiene alumnos a su cargo, también se eliminarán ellos y su historial. Revisa el detalle antes de continuar." : "Antes de eliminarlo, revisa los datos asociados que también se borrarán. Su papá o tutor y los demás alumnos a su cargo se conservarán."}</p>
    {preview && !cleanup && <>
      {isGuardian && Boolean(preview.students?.length) && <div className="student-error my-3"><strong>También se eliminarán estos alumnos:</strong><ul>{preview.students?.map(row => <li key={row.id}>{row.full_name}</li>)}</ul><p>Si deben seguir en la academia, cancela y asígnalos a otro tutor desde Editar alumno antes de borrar este tutor.</p></div>}
      <ul className="student-delete-inventory" aria-label="Datos que se eliminarán">{preview.items.map(item => <li key={item.label}><span>{item.label}</span><strong>{item.count}</strong></li>)}{preview.file_count > 0 && <li><span>Archivos propios en Futsi</span><strong>{preview.file_count}</strong></li>}</ul>
      <p className="student-hint my-3">{isTournament ? "Se conservan las fichas de alumnos, sus tutores, la sede y los datos de otros torneos." : isGuardian ? "Se conservan las sedes, equipos y sesiones compartidas. La cuenta de acceso, si existe, se administra por separado en Usuarios." : "Se conservarán el tutor, sus otros alumnos y los recursos compartidos, como sedes, equipos y sesiones."}</p>
      <label className="student-delete-name-input">Escribe <strong>{preview.full_name}</strong> para confirmar<input autoComplete="off" spellCheck={false} value={name} disabled={busy} onChange={event => setName(event.target.value)} aria-label={`Nombre del ${noun} para confirmar eliminación definitiva`} /></label>
    </>}
    {error && <p role="alert" className="student-error mt-3">{error}</p>}
    {error && preview && !cleanup && <button className="student-text-button" onClick={() => void review()} disabled={busy}>Actualizar detalle antes de confirmar</button>}
    <div className="student-actions">
      <button autoFocus className="student-button secondary" onClick={onClose} disabled={busy}>{cleanup ? "Cerrar" : "Cancelar"}</button>
      {cleanup ? <button className="student-button student-delete-confirm" disabled={busy} onClick={() => void retryFiles()}>{busy ? "Reintentando…" : "Reintentar archivos"}</button>
        : preview ? <button className="student-button student-delete-confirm" onClick={() => void remove()} disabled={busy || name.trim() !== preview.full_name.trim()}><Trash2 size={15} />{busy ? "Eliminando…" : "Eliminar definitivamente"}</button>
          : <button className="student-button student-delete-confirm" onClick={() => void review()} disabled={busy}>{busy ? "Consultando…" : "Revisar datos asociados"}<ArrowRight size={15} /></button>}
    </div>
    </>}
  </dialog>, document.body);
}
