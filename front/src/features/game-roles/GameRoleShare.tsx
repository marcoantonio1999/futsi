import { useEffect, useRef, useState } from "react";
import { API_URL, apiRequest } from "../../api";
import { Button, Dialog } from "../../components/ui/enrollment-ui";
import { roleTimeLabel } from "./roleSchedule";
import { roleReminders } from "./roleReminders";
import "./gameRoleShare.css";

import { ScheduleSheet, dayName, renderScheduleImage, type Schedule } from "./GameRoleReport";

async function downloadScheduleImage(schedule: Schedule) {
  const canvas = await renderScheduleImage(schedule);
  const tournament = schedule.tournament.trim().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 80);
  const filename = `rol-${tournament}-jornada-${schedule.number}.png`;
  const native = (window as Window & {
    Capacitor?: { Plugins?: { EnrollmentPrint?: { saveRolePng(input: { filename: string; data: string }): Promise<void> } } };
  }).Capacitor?.Plugins?.EnrollmentPrint;
  if (native) {
    await native.saveRolePng({ filename, data: canvas.toDataURL("image/png").split(",")[1] });
    return true;
  }
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error()), "image/png"));
  const href = URL.createObjectURL(png);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  return false;
}

export function GameRoleShare({ path, token, reminderKey, upcomingOnly = false, onClose }: {
  path: string; token: string; reminderKey: string; upcomingOnly?: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [schedule, setSchedule] = useState<(Schedule & { token: string }) | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const node = dialog.current;
    node?.showModal();
    apiRequest<Schedule & { token: string }>(path, token, { signal: controller.signal })
      .then(result => setSchedule(upcomingOnly ? { ...result, matches: result.matches.filter(match => !match.played) } : result))
      .catch(() => { if (!controller.signal.aborted) setStatus("No se pudo generar el rol de juego."); });
    return () => { controller.abort(); node?.close(); };
  }, [path, token, upcomingOnly]);
  const url = schedule ? `${location.origin}${location.pathname}#/rol-de-juego/${encodeURIComponent(schedule.token)}` : "";
  const message = schedule ? [
    `*Rol de juego · Jornada ${schedule.number}*`, `${schedule.tournament} · ${schedule.site}`, "",
    ...schedule.matches.map(match => `${dayName(match.scheduled_on ?? schedule.starts_on)} · ${roleTimeLabel(schedule.tournament, match.starts_at, match.ends_at)}\n${match.home_team__name} vs. ${match.away_team__name}`),
    ...(schedule.rest_team ? [`Descanso · ${schedule.rest_team}`] : []),
    "", "Consulta el rol actualizado aquí", url,
  ].join("\n") : "";
  return <Dialog ref={dialog} className="game-roles-dialog game-role-share-dialog" aria-label="Compartir rol de juego"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="game-role-share-body">
      {schedule && <ScheduleSheet schedule={schedule} />}
      {!schedule && <p role="status">{status || "Generando rol…"}</p>}
    </div>
    <footer className="game-role-share-controls">
      {schedule && (!upcomingOnly || schedule.matches.length > 0 || schedule.rest_team) && <>
        <label>Enlace público<input value={url} readOnly onFocus={event => event.currentTarget.select()} /></label>
        <Button type="button" onClick={() => void downloadScheduleImage(schedule).then(
          saved => { if (saved) setStatus("Imagen guardada."); },
          () => setStatus("No se pudo descargar la imagen."),
        )}>Descargar imagen</Button>
        <Button type="button" onClick={() => void navigator.clipboard.writeText(url).then(
          () => setStatus("Enlace copiado."), () => setStatus("Selecciona y copia el enlace público."),
        )}>Copiar enlace</Button>
        <a className="game-role-share-action" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
          onClick={() => void roleReminders?.shared({ key: reminderKey }).catch(
            () => setStatus("No se pudo cancelar el recordatorio de cierre."),
          )}>Compartir por WhatsApp</a>
      </>}
      <Button type="button" onClick={onClose}>Cerrar</Button>
      {schedule && status && <p role="status">{status}</p>}
    </footer>
  </Dialog>;
}

export function PublicGameRole({ token }: { token: string }) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [status, setStatus] = useState("Cargando rol de juego…");
  useEffect(() => {
    document.title = "Rol de juego | Futsi";
    const controller = new AbortController();
    let pending = false;
    let revision = "";
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`${API_URL}/public/game-roles/${encodeURIComponent(token)}/?revision=${encodeURIComponent(revision)}`, {
          signal: controller.signal, cache: "no-store", credentials: "omit",
        });
        if (response.status === 404) {
          revision = "";
          setSchedule(null);
          setStatus("Este rol de juego no está disponible.");
          return;
        }
        if (response.status === 204) { setStatus(""); return; }
        if (!response.ok) throw new Error();
        const result: Schedule & { revision?: string } = await response.json();
        revision = result.revision ?? "";
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
    {schedule && <ScheduleSheet schedule={schedule} live />}
    {status && <p role="status">{status}</p>}
  </main>;
}
