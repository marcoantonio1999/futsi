import { useEffect, useRef, useState } from "react";
import { API_URL, apiRequest } from "../../api";
import { Button, Dialog } from "../../components/ui/enrollment-ui";
import "./gameRoleShare.css";

type Match = {
  scheduled_on: string; starts_at: string; ends_at: string; played: boolean;
  home_team__name: string; away_team__name: string;
};
type Schedule = { tournament: string; site: string; number: number; starts_on: string; matches: Match[] };
type PublicSchedule = Schedule & { scoring?: { team: string; goals: number }[] };
const dayLabel = new Intl.DateTimeFormat("es-MX", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const dayName = (day: string) => dayLabel.format(new Date(day + "T00:00:00Z"));
const timeRange = (match: Match) => `${match.starts_at.slice(0, 5)}–${match.ends_at.slice(0, 5)}`;

function scheduleDays(schedule: Schedule) {
  const days = new Map<string, Match[]>();
  for (const match of schedule.matches) {
    const matches = days.get(match.scheduled_on) ?? [];
    matches.push(match);
    days.set(match.scheduled_on, matches);
  }
  return [...days];
}

function MatchDays({ schedule }: { schedule: Schedule }) {
  return scheduleDays(schedule).map(([day, matches]) => <section key={day}>
      <h2>{dayName(day)}</h2>
      <ul>{matches.map((match, index) => <li key={index}>
        <strong>{timeRange(match)}</strong>
        <span>{match.home_team__name} <small>vs.</small> {match.away_team__name}</span>
        {match.played && <small>Jugado</small>}
      </li>)}</ul>
    </section>);
}

function ScheduleSheet({ schedule, publicView = false }: { schedule: Schedule; publicView?: boolean }) {
  const upcoming = publicView ? schedule.matches.filter(match => !match.played) : schedule.matches;
  const played = publicView ? schedule.matches.filter(match => match.played) : [];
  return <article className="game-role-sheet">
    <header><small>FUTSI · ROL DE JUEGO</small><h1>Jornada {schedule.number}</h1>
      <p>{schedule.tournament} · {schedule.site}</p></header>
    {publicView && <h2 className="game-role-public-heading">Próximos partidos</h2>}
    {!upcoming.length && <p className="game-role-sheet-empty">Todavía no hay {publicView ? "próximos partidos" : "partidos programados"} para esta jornada.</p>}
    <MatchDays schedule={{ ...schedule, matches: upcoming }} />
    {played.length > 0 && <>
      <h2 className="game-role-public-heading">Partidos jugados</h2>
      <MatchDays schedule={{ ...schedule, matches: played }} />
    </>}
  </article>;
}

async function downloadScheduleImage(schedule: Schedule) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error();
  const ctx = context;
  const width = 840;
  const padding = 36;
  function wrap(text: string, maxWidth: number, font: string) {
    ctx.font = font;
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (ctx.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  const subtitleFont = "26px system-ui, sans-serif";
  const teamsFont = "600 28px system-ui, sans-serif";
  const subtitle = wrap(`${schedule.tournament} · ${schedule.site}`, width - 2 * padding, subtitleFont);
  const groups = scheduleDays(schedule).map(([day, matches]) => ({
    day, rows: matches.map(match => ({
      match, lines: wrap(`${match.home_team__name} vs. ${match.away_team__name}`, width - 2 * padding - 205, teamsFont),
    })),
  }));
  const headerHeight = 144 + subtitle.length * 34;
  const rowHeight = (lines: string[]) => Math.max(68, lines.length * 36 + 24);
  const height = headerHeight + 28 + (groups.length
    ? groups.reduce((sum, group) => sum + 62 + group.rows.reduce((n, row) => n + rowHeight(row.lines), 0), 0)
    : 70);
  canvas.width = width;
  canvas.height = height;
  ctx.textBaseline = "top";
  function label(text: string, x: number, y: number, font: string, color: string) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#174734";
  ctx.fillRect(0, 0, width, headerHeight);
  label("ROL DE JUEGO", padding, 28, "700 22px system-ui, sans-serif", "#c9e6d6");
  label(`Jornada ${schedule.number}`, padding, 63, "800 54px system-ui, sans-serif", "#ffffff");
  subtitle.forEach((line, index) => label(line, padding, 126 + index * 34, subtitleFont, "#ffffff"));
  let y = headerHeight;
  for (const group of groups) {
    ctx.fillStyle = "#edf3ef";
    ctx.fillRect(0, y, width, 62);
    const day = dayName(group.day);
    label(day.charAt(0).toUpperCase() + day.slice(1), padding, y + 17, teamsFont, "#174734");
    y += 62;
    for (const { match, lines } of group.rows) {
      label(timeRange(match), padding, y + 16, "700 27px system-ui, sans-serif", "#174734");
      lines.forEach((line, index) => label(line, padding + 205, y + 16 + index * 36, teamsFont, "#173629"));
      y += rowHeight(lines);
      ctx.fillStyle = "#d4e1d9";
      ctx.fillRect(padding, y - 1, width - 2 * padding, 1);
    }
  }
  if (!groups.length) label("Todavía no hay partidos programados.", padding, y + 22, subtitleFont, "#173629");
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error()), "image/png"));
  const href = URL.createObjectURL(png);
  const link = document.createElement("a");
  const tournament = schedule.tournament.trim().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 80);
  link.href = href;
  link.download = `rol-${tournament}-jornada-${schedule.number}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
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
        <Button type="button" onClick={() => void downloadScheduleImage(schedule).catch(
          () => setStatus("No se pudo descargar la imagen."),
        )}>Descargar imagen</Button>
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
  const [schedule, setSchedule] = useState<PublicSchedule | null>(null);
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
        const result: PublicSchedule = await response.json();
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
    {schedule && <>
      <ScheduleSheet schedule={schedule} publicView />
      <section className="game-role-sheet game-role-public-scoring">
        <h2 className="game-role-public-heading">Tabla de goleo</h2>
        <table>
          <thead><tr><th scope="col">Pos.</th><th scope="col">Equipo</th><th scope="col">Goles</th></tr></thead>
          <tbody>{schedule.scoring?.length ? schedule.scoring.map((row, index) => <tr key={index}>
            <td>{index + 1}</td><th scope="row">{row.team}</th><td>{row.goals}</td>
          </tr>) : <tr><td colSpan={3}>Todavía no hay marcadores registrados.</td></tr>}</tbody>
        </table>
      </section>
    </>}
    {status && <p role="status">{status}</p>}
  </main>;
}
