import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Site } from "../../types";
import { apiRequest } from "../../api";
import { TextInput } from "./shared";
import { useSitesNavigation } from "./sitesNavigation";

const emptyForm = { name: "", code: "", address: "", latitude: "", longitude: "", is_active: true, close_editing_after_hours: 24 };
const secondary = "rounded-md border border-zinc-300 bg-white px-4 py-2 font-medium disabled:opacity-50";
const primary = "rounded-md bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50";
type DeletionPreview = { full_name: string; items: { label: string; count: number }[]; accounts: { username: string; role: string }[]; retained_accounts: { username: string; role: string }[]; preserved_debts: { student: string; guardian: string; balance: string }[]; active_guardians: number; preserved_payments: number; detached_actor_references: number; file_count: number; blockers: string[]; confirmation_token: string };

export function SitesWorkspace({ sites, token, onRefresh }: { sites: Site[]; token: string; onRefresh: () => void }) {
  const { section, revision, select, canManage } = useSitesNavigation();
  const [editing, setEditing] = useState<Site | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleting, setDeleting] = useState<Site | null>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setEditing(null); setForm(emptyForm); setError(""); }, [section, revision]);
  useEffect(() => { if (deleting) dialog.current?.showModal(); }, [deleting]);
  useEffect(() => {
    if (!deleting) return;
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setPreview(null); setConfirmation(""); setAccepted(false); setError("");
    apiRequest<DeletionPreview>(`/sites/${deleting.id}/deletion-preview/`, token, { signal: controller.signal })
      .then(value => { if (current) setPreview(value); })
      .catch(err => {
        if (!current) return;
        setError(err instanceof DOMException && err.name === "AbortError"
          ? "La consulta tardó más de 15 segundos y se canceló. Verifica la conexión e inténtalo de nuevo."
          : err instanceof Error ? err.message : "No se pudo consultar el detalle.");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => { current = false; window.clearTimeout(timeout); controller.abort(); };
  }, [deleting, token, previewAttempt]);

  function edit(site: Site) {
    setEditing(site); setError(""); setNotice("");
    setForm({ name: site.name, code: site.code, address: site.address, latitude: site.latitude ?? "", longitude: site.longitude ?? "", is_active: site.is_active, close_editing_after_hours: site.close_editing_after_hours });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest(editing ? `/sites/${editing.id}/` : "/sites/", token, { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...form, name: form.name.trim(), code: form.code.trim(), latitude: form.latitude || null, longitude: form.longitude || null }) });
      setNotice(editing ? "Sede actualizada." : "Sede creada.");
      setEditing(null); setForm(emptyForm); select("overview"); onRefresh();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar la sede."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy || !preview || preview.blockers.length || !accepted || confirmation.trim() !== deleting.name.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ cleanup_pending: number }>(`/sites/${deleting.id}/`, token, { method: "DELETE", body: JSON.stringify({ confirmation_name: confirmation, confirmation_token: preview.confirmation_token, accept_permanent: accepted }) });
      setNotice(`Se eliminó la sede «${deleting.name}» y los registros confirmados. Se conservaron las cuentas personales y los adeudos de tutores con hijos en otra sede.${result.cleanup_pending ? ` Quedan ${result.cleanup_pending} archivos pendientes de limpieza; en local no se borran archivos de producción.` : ""}`); setDeleting(null); onRefresh();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo eliminar la sede."); }
    finally { setBusy(false); }
  }
  const showForm = canManage && (section === "create" || editing);
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-semibold uppercase text-emerald-800">Sedes</p><h2 className="text-2xl font-bold">{showForm ? editing ? "Editar sede" : "Agregar nueva sede" : "Resumen"}</h2></div>
      {!showForm && canManage && <button type="button" className={`${primary} flex items-center gap-2`} onClick={() => select("create")}><Plus size={18} />Agregar nueva sede</button>}
    </header>
    {notice && <p role="status" className="rounded-md bg-emerald-50 p-3 text-emerald-900">{notice}</p>}
    {error && !deleting && <p role="alert" className="rounded-md bg-red-50 p-3 text-red-800">{error}</p>}
    {showForm ? <form onSubmit={submit} className="rounded-xl border border-zinc-200 bg-white p-6">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <TextInput label="Nombre" required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <TextInput label="Código" required maxLength={40} pattern="[a-zA-Z0-9_-]+" title="Usa letras, números, guiones o guion bajo, sin espacios." value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
        <div className="sm:col-span-2"><TextInput label="Dirección" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
        <TextInput label="Latitud" type="number" min={-90} max={90} step="0.000001" value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} />
        <TextInput label="Longitud" type="number" min={-180} max={180} step="0.000001" value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} />
        <TextInput label="Horas para editar" type="number" min={1} max={32767} required value={form.close_editing_after_hours} onChange={e => setForm({ ...form, close_editing_after_hours: Number(e.target.value) })} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Sede activa</label>
        <div className="flex gap-3 sm:col-span-2"><button className={primary} type="submit">{busy ? "Guardando…" : "Guardar sede"}</button><button type="button" className={secondary} onClick={() => { setEditing(null); select("overview"); setError(""); }}>Cancelar</button></div>
      </fieldset>
    </form> : <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full text-left"><caption className="p-4 text-left text-sm text-zinc-600">{sites.length} sedes · {sites.filter(site => site.is_active).length} activas</caption><thead className="bg-zinc-50"><tr>{["Sede", "Dirección", "Alumnos", "Estado", ...(canManage ? ["Acciones"] : [])].map(label => <th key={label} scope="col" className="p-4">{label}</th>)}</tr></thead>
        <tbody>{sites.map(site => <tr key={site.id} className="border-t border-zinc-100">
          <td className="p-4"><span className="font-semibold">{site.name}</span><span className="block text-sm text-zinc-500">{site.code}</span></td><td className="p-4">{site.address || "Sin dirección"}</td><td className="p-4">{site.student_count ?? 0}</td><td className="p-4">{site.is_active ? "Activa" : "Inactiva"}</td>
          {canManage && <td className="p-4"><div className="flex gap-2"><button type="button" className={`${secondary} flex items-center gap-2`} aria-label={`Editar ${site.name}`} onClick={() => edit(site)}><Pencil size={16} /><span>Editar</span></button><button type="button" className={`${secondary} flex items-center gap-2 text-red-700`} aria-label={`Eliminar ${site.name}`} onClick={() => { setError(""); setNotice(""); setDeleting(site); }}><Trash2 size={16} /><span>Eliminar</span></button></div></td>}
        </tr>)}</tbody>
      </table>{!sites.length && <p className="p-6 text-zinc-500">Todavía no hay sedes registradas.</p>}
    </div>}
    {deleting && <dialog ref={dialog} aria-labelledby="delete-site-title" onCancel={e => { if (busy) e.preventDefault(); else { setDeleting(null); setError(""); } }} className="m-auto max-h-[90vh] w-[min(92vw,680px)] overflow-y-auto rounded-xl p-6 shadow-xl backdrop:bg-black/40">
      <h3 id="delete-site-title" className="text-xl font-bold">¿Eliminar «{deleting.name}» y todos sus datos?</h3>
      <p className="my-4 rounded-md bg-red-50 p-3 text-red-900">Esta acción es permanente. Se eliminarán los registros listados y las cuentas de caja. Los tutores con hijos en otra sede conservarán su acceso y sus adeudos pendientes, con sus abonos. Las demás cuentas personales se conservarán inactivas y sin sede.</p>
      {!preview && !error && <p role="status">Consultando todos los registros asociados…</p>}
      {preview && <div className="space-y-4">
        {!!preview.active_guardians && <p className="rounded-md bg-emerald-50 p-3">{preview.active_guardians} tutores conservarán su acceso por tener hijos en otra sede.</p>}
        {!!preview.preserved_debts?.length && <section className="rounded-md border border-amber-300 bg-amber-50 p-3"><h4 className="font-semibold">Adeudos que NO se eliminarán</h4><ul>{preview.preserved_debts.map((debt, index) => <li key={index} className="py-2">{debt.guardian} · {debt.student} · Saldo ${Number(debt.balance).toFixed(2)}</li>)}</ul><p>Se conservarán {preview.preserved_payments} pagos asociados. El tutor seguirá viendo el saldo con la referencia de esta sede.</p></section>}
        {!!preview.detached_actor_references && <p className="rounded-md bg-zinc-50 p-3">{preview.detached_actor_references} referencias a cuentas de caja se separarán sin borrar los registros conservados. El usuario original quedará registrado en auditoría.</p>}
        <ul className="divide-y rounded-md border p-3">{preview.items.map(item => <li key={item.label} className="flex justify-between gap-4 py-2"><span>{item.label}</span><strong>{item.count}</strong></li>)}</ul>
        {!!preview.accounts.length && <details><summary className="cursor-pointer font-semibold text-red-800">Cuentas de caja que se eliminarán definitivamente: {preview.accounts.length}</summary><ul className="max-h-40 overflow-y-auto p-3">{preview.accounts.map(account => <li key={account.username}>{account.username} · {account.role}</li>)}</ul></details>}
        {!!preview.retained_accounts?.length && <details><summary className="cursor-pointer font-semibold">Se conservarán {preview.retained_accounts.length} cuentas, inactivas y sin sede</summary><p className="mt-2 text-sm">No podrán iniciar sesión hasta su reactivación y reasignación. Conservan su usuario y contraseña; no necesitan otra cuenta.</p><ul className="max-h-40 overflow-y-auto p-3">{preview.retained_accounts.map(account => <li key={account.username}>{account.username} · {account.role}</li>)}</ul></details>}
        {!!preview.file_count && <p className="text-sm">{preview.file_count} archivos vinculados quedarán pendientes de limpieza. En las pruebas locales no se eliminarán archivos del almacenamiento de producción.</p>}
        {preview.blockers.map(blocker => <p key={blocker} role="alert" className="rounded-md bg-red-50 p-3 text-red-800">{blocker}</p>)}
        {!preview.blockers.length && <><TextInput label={`Escribe ${deleting.name} para confirmar`} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /><label className="flex items-start gap-2"><input type="checkbox" checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} /><span>Entiendo qué registros se eliminarán y qué cuentas, adeudos y pagos se conservarán según este resumen.</span></label></>}
      </div>}
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-red-800">{error}</p>}
      {error && !preview && <button type="button" className={secondary} onClick={() => setPreviewAttempt(value => value + 1)}>Reintentar consulta</button>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" autoFocus disabled={busy} className={secondary} onClick={() => { setDeleting(null); setError(""); }}>Cancelar</button><button type="button" disabled={busy || !preview || !!preview.blockers.length || !accepted || confirmation.trim() !== deleting.name.trim()} className="rounded-md bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50" onClick={remove}>{busy ? "Eliminando…" : "Eliminar sede y sus datos"}</button></div>
    </dialog>}
  </div>;
}
