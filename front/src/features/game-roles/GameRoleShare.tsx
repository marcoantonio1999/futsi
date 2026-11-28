import { useEffect, useRef, useState } from "react";
import { API_URL, apiRequest } from "../../api";
import { Button, Dialog } from "../../components/ui/enrollment-ui";
import { roleTimeLabel } from "./roleSchedule";
import { roleReminders } from "./roleReminders";
import "./gameRoleShare.css";

import { ScheduleSheet, dayName, renderScheduleImage, scheduleRestTeams, type Schedule } from "./GameRoleReport";

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
  const restTeams = schedule ? scheduleRestTeams(schedule) : [];
  const message = schedule ? [
    `*Rol de juego · Jornada ${schedule.number}*`, `${schedule.tournament} · ${schedule.site}`, "",
    ...schedule.matches.map(match => `${dayName(match.scheduled_on ?? schedule.starts_on)} · ${roleTimeLabel(schedule.tournament, match.starts_at, match.ends_at)}\n${match.home_team__name} vs. ${match.away_team__name}`),
    ...(restTeams.length ? ["*Descanso*", ...restTeams] : []),
    "", "Consulta el rol actualizado aquí", url,
  ].join("\n") : "";
  return <Dialog ref={dialog} className="game-roles-dialog game-role-share-dialog" aria-label="Compartir rol de juego"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="game-role-share-body">
      {schedule && <ScheduleSheet schedule={schedule} />}
      {!schedule && <p role="status">{status || "Generando rol…"}</p>}
    </div>
    <footer className="game-role-share-controls">
      {schedule && (!upcomingOnly || schedule.matches.length > 0 || restTeams.length > 0) && <>
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
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const lastReport = useRef({ token, revision: "" });
  useEffect(() => {
    document.title = "Rol de juego | Futsi";
    const controller = new AbortController();
    if (lastReport.current.token !== token) {
      lastReport.current = { token, revision: "" };
      setSchedule(null);
    }
    setLoading(true);
    setStatus(reload ? "Actualizando rol…" : "Cargando rol de juego…");
    async function refresh() {
      try {
        const response = await fetch(`${API_URL}/public/game-roles/${encodeURIComponent(token)}/?revision=${encodeURIComponent(lastReport.current.revision)}`, {
          signal: controller.signal, cache: "no-store", credentials: "omit",
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          lastReport.current.revision = "";
          setSchedule(null);
          setStatus("Este rol de juego no está disponible.");
          return;
        }
        if (response.status === 204) { setStatus(""); return; }
        if (!response.ok) throw new Error();
        const result: Schedule & { revision?: string } = await response.json();
        if (!controller.signal.aborted) {
          lastReport.current.revision = result.revision ?? "";
          setSchedule(result);
          setStatus("");
        }
      } catch {
        if (!controller.signal.aborted) setStatus("No se pudo consultar el rol. Usa «Recargar rol» para reintentar.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    return () => controller.abort();
  }, [token, reload]);
  return <main className="game-role-public">
    <div className="game-role-public-toolbar">
      <Button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>Recargar rol</Button>
    </div>
    {schedule && <ScheduleSheet schedule={schedule} />}
    {status && <p role="status">{status}</p>}
  </main>;
}
