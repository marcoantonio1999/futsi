import { useEffect, useRef, useState } from "react";
import { API_URL, apiRequest } from "../../api";
import { Button, Dialog } from "../../components/ui/enrollment-ui";
import "./gameRoleShare.css";

type Match = {
  scheduled_on: string; starts_at: string; ends_at: string; played: boolean;
  home_team__name: string; away_team__name: string;
};
type Schedule = { tournament: string; site: string; number: number; starts_on: string; matches: Match[] };
const dayLabel = new Intl.DateTimeFormat("es-MX", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const dayName = (day: string) => dayLabel.format(new Date(day + "T00:00:00Z"));
const timeRange = (match: Match) => `${match.starts_at.slice(0, 5)}–${match.ends_at.slice(0, 5)}`;

function ScheduleSheet({ schedule }: { schedule: Schedule }) {
  const days = new Map<string, Match[]>();
  for (const match of schedule.matches) {
    const matches = days.get(match.scheduled_on) ?? [];
    matches.push(match);
    days.set(match.scheduled_on, matches);
  }
  return <article className="game-role-sheet">
    <header><small>FUTSI · ROL DE JUEGO</small><h1>Jornada {schedule.number}</h1>
      <p>{schedule.tournament} · {schedule.site}</p></header>
    {!days.size && <p className="game-role-sheet-empty">Todavía no hay partidos programados para esta jornada.</p>}
    {[...days].map(([day, matches]) => <section key={day}>
      <h2>{dayName(day)}</h2>
      <ul>{matches.map((match, index) => <li key={index}>
        <strong>{timeRange(match)}</strong>
        <span>{match.home_team__name} <small>vs.</small> {match.away_team__name}</span>
        {match.played && <small>Jugado</small>}
      </li>)}</ul>
    </section>)}
  </article>;
}

export function GameRoleShare({ path, token, onClose }: { path: string; token: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [schedule, setSchedule] = useState<(Schedule & { token: string }) | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const node = dialog.current;
    node?.showModal();
    apiRequest<Schedule & { token: string }>(path, token, { signal: controller.signal })
      .then(setSchedule).catch(() => { if (!controller.signal.aborted) setStatus("No se pudo generar el rol de juego."); });
    return () => { controller.abort(); node?.close(); };
  }, [path, token]);
  const url = schedule ? `${location.origin}${location.pathname}#/rol-de-juego/${encodeURIComponent(schedule.token)}` : "";
  const message = schedule ? [
    `*Rol de juego · Jornada ${schedule.number}*`, `${schedule.tournament} · ${schedule.site}`, "",
    ...schedule.matches.map(match => `${dayName(match.scheduled_on)} · ${timeRange(match)}\n${match.home_team__name} vs. ${match.away_team__name}`),
    "", "Consulta el rol actualizado aquí", url,
  ].join("\n") : "";
  return <Dialog ref={dialog} className="game-roles-dialog game-role-share-dialog" aria-label="Compartir rol de juego"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    {schedule ? <><ScheduleSheet schedule={schedule} />
      <label>Enlace público<input value={url} readOnly onFocus={event => event.currentTarget.select()} /></label>
      <footer>
        <Button type="button" onClick={() => void navigator.clipboard.writeText(url).then(
          () => setStatus("Enlace copiado."), () => setStatus("Selecciona y copia el enlace público."),
        )}>Copiar enlace</Button>
        <a className="game-role-share-action" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
      </footer>
    </> : !status && <p role="status">Generando rol…</p>}
    {status && <p role="status">{status}</p>}
    <footer><Button type="button" onClick={onClose}>Cerrar</Button></footer>
  </Dialog>;
}

export function PublicGameRole({ token }: { token: string }) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [status, setStatus] = useState("Cargando rol de juego…");
  useEffect(() => {
    document.title = "Rol de juego | Futsi";
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`${API_URL}/public/game-roles/${encodeURIComponent(token)}/`, {
          signal: controller.signal, cache: "no-store", credentials: "omit",
        });
        if (response.status === 404) {
          setSchedule(null);
          setStatus("Este rol de juego no está disponible.");
          return;
        }
        if (!response.ok) throw new Error();
        const result: Schedule = await response.json();
        if (!controller.signal.aborted) { setSchedule(result); setStatus(""); }
      } catch {
        if (!controller.signal.aborted) setStatus("No se pudo consultar el rol. Se volverá a intentar.");
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token]);
  return <main className="game-role-public">
    {schedule && <ScheduleSheet schedule={schedule} />}
    {status && <p role="status">{status}</p>}
  </main>;
}
