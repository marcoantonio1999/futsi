import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck2, CalendarDays, Database, Radio, Settings2, Trophy, WifiOff } from "lucide-react";
import logoUrl from "../../../../face_station/app/static/logo-futsi.png";
import { stationApi } from "./api";
import { Button, StatusDot } from "./components";
import { DailyAttendanceView } from "./DailyAttendanceView";
import { DetectionModal } from "./DetectionModal";
import { IdentityCatalogView } from "./IdentityCatalogView";
import { LiveView } from "./LiveView";
import { MatchAnalysisView } from "./MatchAnalysisView";
import { MonthlyAttendanceView } from "./MonthlyAttendanceView";
import { SettingsModal } from "./SettingsModal";
import type { DetectionTarget, StationStatus, TabId, ToastMessage } from "./types";

const tabs: Array<{ id: TabId; label: string; icon: typeof Radio }> = [
  { id: "live", label: "Operación en vivo", icon: Radio },
  { id: "attendance", label: "Asistencia del día", icon: CalendarCheck2 },
  { id: "monthly", label: "Resumen mensual", icon: CalendarDays },
  { id: "matches", label: "Partidos", icon: Trophy },
  { id: "identities", label: "Base local", icon: Database },
];

export default function FaceStationApp() {
  const [activeTab, setActiveTab] = useState<TabId>("live");
  const [status, setStatus] = useState<StationStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DetectionTarget | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const statusRequestActive = useRef(false);

  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "success") => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  const loadStatus = useCallback(async () => {
    if (statusRequestActive.current) return;
    statusRequestActive.current = true;
    try {
      const nextStatus = await stationApi<StationStatus>("/api/status");
      setStatus(nextStatus);
      setStatusError("");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "No se pudo leer la estación.");
    } finally {
      statusRequestActive.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await loadStatus();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadStatus]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const connected = Number(status?.camera.connected_count || 0);
  const configured = Number(status?.camera.configured_count || 0);
  const cameraLabel = connected ? `${connected}/${configured} cámaras activas` : "Cámaras sin video";

  return (
    <div className="min-h-screen text-zinc-900">
      <header className="border-b border-emerald-950/40 bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-800 text-white shadow-lg shadow-emerald-950/10">
        <div className="mx-auto flex min-h-[76px] max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1.5 shadow-lg shadow-black/15">
              <img className="size-full object-contain" src={logoUrl} alt="Futsi" />
            </div>
            <div className="min-w-0">
              <p className="text-[8px] font-extrabold uppercase tracking-[0.16em] text-emerald-200">Control de acceso inteligente</p>
              <div className="mt-0.5 flex items-baseline gap-2">
                <strong className="text-lg leading-none tracking-tight">Face Station</strong>
                <span className="truncate text-[10px] font-medium text-emerald-100/70">{status ? `${status.site_name} · ${status.device_name}` : "Conectando..."}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <div className="mr-1 hidden text-right lg:block">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-emerald-100/55">Hora local</span>
              <strong className="block text-sm tabular-nums">{clock.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</strong>
            </div>
            <StatusDot ok={connected > 0} warning={Boolean(status?.running)} label={cameraLabel} />
            <StatusDot ok={Boolean(status?.online)} warning={!statusError} label={status?.online ? "Sincronizado" : "Trabajo offline"} />
            <Button className="border-white/80" onClick={() => setSettingsOpen(true)} type="button">
              <Settings2 size={14} /> Configuración
            </Button>
          </div>
        </div>
      </header>

      <nav className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 shadow-sm backdrop-blur" aria-label="Secciones">
        <div className="station-scrollbar mx-auto flex max-w-[1600px] overflow-x-auto px-3 sm:px-7 lg:px-10">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 px-3.5 text-xs font-semibold transition ${activeTab === id ? "text-emerald-800" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"}`}
              data-testid={`tab-${id}`}
              onClick={() => setActiveTab(id)}
              type="button"
            >
              <Icon size={15} strokeWidth={activeTab === id ? 2.5 : 2} /> {label}
              {activeTab === id ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-emerald-600" /> : null}
            </button>
          ))}
        </div>
      </nav>

      {!status?.online && status?.running ? (
        <div className="mx-auto mt-4 flex max-w-[1600px] items-center gap-2 px-4 text-xs font-medium text-amber-800 sm:px-7 lg:px-10">
          <div className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <WifiOff size={15} /> Sin internet. Las detecciones siguen guardándose en esta PC y se sincronizarán automáticamente.
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-7 lg:px-10 lg:py-6">
        <div key={activeTab} className="station-page-enter">
          {activeTab === "live" ? <LiveView status={status} onRefreshStatus={loadStatus} onNotify={notify} /> : null}
          {activeTab === "attendance" ? <DailyAttendanceView onOpenDetail={setDetailTarget} onNotify={notify} /> : null}
          {activeTab === "monthly" ? <MonthlyAttendanceView onOpenDetail={setDetailTarget} onNotify={notify} /> : null}
          {activeTab === "matches" ? <MatchAnalysisView onNotify={notify} /> : null}
          {activeTab === "identities" ? <IdentityCatalogView onOpenDetail={setDetailTarget} /> : null}
        </div>
      </main>

      {detailTarget ? (
        <DetectionModal
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
          onNotify={notify}
        />
      ) : null}
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} onNotify={notify} /> : null}
      {toast ? (
        <div
          className={`station-toast-enter fixed bottom-5 right-5 z-[70] max-w-sm rounded-xl border px-4 py-3 text-xs font-semibold shadow-2xl ${toast.tone === "error" ? "border-red-200 bg-red-700 text-white" : "border-emerald-200 bg-emerald-800 text-white"}`}
          role="status"
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}
