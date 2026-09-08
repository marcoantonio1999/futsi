import { useState } from "react";
import type { TrialBooking, TrialVisit } from "../../types";
import { localDateKey, nameNeedsReview } from "./communicationUtils";
import { formatShortDate, secondaryButtonClass } from "./model";

export function TrialAgenda({ bookings, range, onEditBooking, onEditVisit, onUpdateVisit }: {
  bookings: TrialBooking[]; range: string; onEditBooking: (booking: TrialBooking) => void;
  onEditVisit: (visit: TrialVisit) => void; onUpdateVisit: (visit: TrialVisit, payload: unknown) => Promise<void>;
}) {
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + (range === "today" ? 1 : range === "week" ? 7 : 30));
  const rows = bookings.filter(b => b.status !== "canceled").flatMap(booking => booking.visits.map(visit => ({ booking, visit })))
    .filter(({ visit }) => range === "all" || (range === "overdue" ? visit.status === "scheduled" && new Date(visit.ends_at).getTime() < Date.now() : new Date(visit.starts_at) >= today && new Date(visit.starts_at) < end))
    .sort((a, b) => a.visit.starts_at.localeCompare(b.visit.starts_at));
  const groups = new Map<string, typeof rows>();
  rows.forEach(row => { const key = localDateKey(row.visit.starts_at); groups.set(key, [...(groups.get(key) ?? []), row]); });
  async function mark(visit: TrialVisit, status: "completed" | "no_show") {
    if (saving !== null) return;
    setSaving(visit.id); setError("");
    try { await onUpdateVisit(visit, { status }); } catch (err) { setError(err instanceof Error ? err.message : "No se pudo actualizar la visita."); } finally { setSaving(null); }
  }
  return <div className="comm-agenda">
    <p className="comm-muted">{rows.length} visitas · Hora local de tu dispositivo</p>{error && <p role="alert" className="comm-error">{error}</p>}
    {[...groups.entries()].map(([date, items]) => <section className="comm-agenda-day" key={date}><h3>{formatShortDate(date + "T12:00:00")} · {items.length} visitas</h3><div className="comm-panel">{items.map(({ booking, visit }) => <article className="comm-agenda-item" key={visit.id}>
      <time className="comm-agenda-time">{new Date(visit.starts_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })}</time><div className="comm-row-main"><strong>{booking.child_first_name || "Nombre por confirmar"}</strong><span>{booking.responsible_name} · {visit.site_name}</span><small>Visita {visit.visit_number} · {visit.court_name || "Cancha por definir"} · {({ scheduled: "Agendada", completed: "Asistió", no_show: "No asistió", canceled: "Cancelada" })[visit.status]}</small>{nameNeedsReview(booking.child_first_name) && <span className="comm-badge amber">Confirmar nombre del niño</span>}</div>
      <div className="comm-agenda-actions">{visit.status === "scheduled" && new Date(visit.starts_at).getTime() <= Date.now() && <><button className={secondaryButtonClass} disabled={saving !== null} onClick={() => void mark(visit, "completed")}>{saving === visit.id ? "Guardando…" : "Asistió"}</button><button className={secondaryButtonClass} disabled={saving !== null} onClick={() => void mark(visit, "no_show")}>No asistió</button></>}<button className={secondaryButtonClass} disabled={saving !== null} onClick={() => onEditVisit(visit)}>{visit.status === "scheduled" ? "Reprogramar" : "Editar visita"}</button><button className="comm-link" onClick={() => onEditBooking(booking)}>Ver datos</button></div>
    </article>)}</div></section>)}
    {!rows.length && <div className="comm-panel comm-empty"><strong>No hay visitas en este periodo</strong><p>Prueba otro periodo o abre el historial de reservas.</p></div>}
  </div>;
}
