import { Bell, CheckCheck, Clock3, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api";
import type { User } from "../../types";
import { durationLabel } from "../../features/voice-agent/communicationUtils";
import "./attention-notifications.css";

type Alert = { id: string; kind: "average" | "pending"; seconds: number; business_address: string;
  channel_site_name: string; channel_label: string; conversation_id?: number; contact_name?: string; sample_count?: number };
type Alerts = { items: Alert[]; total: number; generated_at: string };

export function AttentionNotifications({ token, user, onOpenChats }: { token: string; user: User; onOpenChats: () => void }) {
  const enabled = ["admin", "owner", "dev", "site_coordinator", "coach"].includes(user.role);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Alerts | null>(null);
  const [error, setError] = useState("");
  const [read, setRead] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const readKey = `futsi:attention-read:${user.id}`;
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(readKey) || "[]"); setRead(Array.isArray(saved) ? saved.filter(v => typeof v === "string") : []); } catch { setRead([]); }
  }, [readKey]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    // One request when the authenticated page mounts. Opening the bell,
    // refocusing the tab and refreshing dashboard data do not query the DB.
    async function load() {
      try {
        const result = await apiRequest<Alerts>("/whatsapp-conversations/attention-notifications/", token, { signal: controller.signal });
        if (active && !controller.signal.aborted) { setData(result); setError(""); }
      } catch (e) {
        if (active && !controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudieron consultar las notificaciones.");
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [token, enabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!enabled) return null;
  const unread = data?.items.filter(a => !read.includes(a.id)).length || 0;
  const markRead = () => { const ids = data?.items.map(a => a.id) || []; setRead(ids); try { localStorage.setItem(readKey, JSON.stringify(ids)); } catch { /* private storage can be unavailable */ } };
  return <div className="attention-notifications" ref={root}>
    <button ref={button} type="button" className="attention-bell" title="Notificaciones" aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`} aria-expanded={open} aria-controls="attention-notifications-panel" onClick={() => setOpen(!open)}>
      <Bell size={18} />{unread > 0 && <span className="attention-badge">{unread > 99 ? "99+" : unread}</span>}{error && <span className="attention-error-dot" />}
    </button>
    {open && <section id="attention-notifications-panel" className="attention-popover" aria-label="Notificaciones de atención">
      <header><strong>Notificaciones</strong><div><button type="button" title="Marcar como leídas" aria-label="Marcar como leídas" onClick={markRead}><CheckCheck size={18} /></button><button type="button" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}><X size={18} /></button></div></header>
      {error && <p className="attention-fetch-error" role="alert">No se pudieron cargar las alertas. Recarga la página para volver a consultar.</p>}
      <div className="attention-alert-list" aria-live="polite">
        {!data && !error && <p className="attention-empty">Consultando…</p>}
        {data && !data.items.length && <p className="attention-empty">Sin alertas de atención</p>}
        {data?.items.map(a => <article key={a.id} className={`attention-alert ${a.kind} ${read.includes(a.id) ? "read" : ""}`}>
          <Clock3 size={18} /><div><strong>{a.kind === "average" ? "Promedio mayor a 1 hora" : "Chat sin respuesta por más de 2 horas"}</strong><p>{a.channel_label || a.channel_site_name || "Número sin sede"}</p><p>{a.kind === "pending" ? a.contact_name : `Últimos 7 días · ${a.sample_count} respuestas`}</p><b>{durationLabel(a.seconds)}</b>
          {user.role !== "coach" && <button type="button" onClick={() => { sessionStorage.setItem("futsi:attention-chat", JSON.stringify(a)); setOpen(false); onOpenChats(); window.dispatchEvent(new Event("futsi:open-attention-chat")); }}>Ver chats →</button>}</div>
        </article>)}
      </div>
      {data && <footer>{data.total} alertas activas{data.total > data.items.length ? ` · mostrando ${data.items.length}` : ""}</footer>}
    </section>}
  </div>;
}
