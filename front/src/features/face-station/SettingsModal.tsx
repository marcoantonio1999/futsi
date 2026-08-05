import { useEffect, useState, type FormEvent } from "react";
import { Cpu, LockKeyhole, Settings2, Video, Wifi, X } from "lucide-react";
import { stationApi } from "./api";
import { Button, LoadingState } from "./components";
import { useEscape } from "./hooks";
import type { StationConfig, ToastMessage } from "./types";

const inputClass = "mt-1.5 min-h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-800 shadow-sm transition focus:border-emerald-500";
const labelClass = "block text-[10px] font-bold uppercase tracking-[0.06em] text-zinc-500";

export function SettingsModal({ onClose, onNotify }: { onClose: () => void; onNotify: (text: string, tone?: ToastMessage["tone"]) => void }) {
  const [config, setConfig] = useState<StationConfig | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    let active = true;
    stationApi<StationConfig>("/api/config")
      .then((payload) => active && setConfig(payload))
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "No se pudo leer la configuración."));
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const numeric = new Set([
      "detector_size", "processing_width", "preview_width", "target_fps",
      "known_threshold", "unknown_threshold", "unknown_confirmation_threshold",
      "spool_jpeg_quality", "night_embedding_batch_size",
      "daily_evidence_limit", "evidence_safety_days",
      "camera_roi_left", "camera_roi_right",
      "secondary_camera_roi_left", "secondary_camera_roi_right",
    ]);
    const roiPercentages = new Set([
      "camera_roi_left", "camera_roi_right",
      "secondary_camera_roi_left", "secondary_camera_roi_right",
    ]);
    const payload: Record<string, string | number | boolean> = {};
    for (const [key, rawValue] of form.entries()) {
      const value = String(rawValue);
      if (["station_token", "secondary_camera_password"].includes(key) && !value) continue;
      payload[key] = key === "secondary_camera_enabled"
        ? value === "true"
        : roiPercentages.has(key)
          ? Number(value) / 100
          : numeric.has(key)
            ? Number(value)
            : value;
    }
    try {
      await stationApi("/api/config", { method: "PATCH", body: JSON.stringify(payload) });
      onNotify("Configuración guardada. El motor se está reiniciando.");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-emerald-950/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="presentation">
      <form className="my-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-white/20 bg-zinc-50 shadow-2xl" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-emerald-700"><Settings2 size={14} /> Administración local</p>
            <h2 id="settings-title" className="mt-1 text-lg font-bold tracking-tight">Configuración de la estación</h2>
            <p className="mt-1 text-xs text-zinc-500">Los cambios reinician el procesamiento sin borrar detecciones.</p>
          </div>
          <button className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50" onClick={onClose} type="button" aria-label="Cerrar"><X size={17} /></button>
        </header>

        {!config && !error ? <LoadingState label="Leyendo configuración segura..." /> : null}
        {error ? <p className="m-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p> : null}
        {config ? (
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-200 bg-white p-4 lg:col-span-2">
              <h3 className="flex items-center gap-2 text-xs font-bold text-zinc-800"><Wifi size={15} className="text-emerald-700" /> Conexión con Futsi</h3>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <label className={labelClass}>URL de Futsi API<input className={inputClass} defaultValue={config.api_url} name="api_url" type="url" required /></label>
                <label className={labelClass}>Proxy privado de referencias<input className={inputClass} defaultValue={config.reference_proxy_url || ""} name="reference_proxy_url" type="url" placeholder="https://PROYECTO.supabase.co/functions/v1/..." /></label>
                <label className={`${labelClass} lg:col-span-2`}><span className="inline-flex items-center gap-1.5"><LockKeyhole size={12} /> Token de estación</span><input className={inputClass} name="station_token" type="password" autoComplete="off" placeholder="Déjalo vacío para conservar el actual" /></label>
              </div>
            </section>

            <CameraSection title="Cámara principal" detail="Fuente conectada a la Raspberry o a esta PC." icon={<Video size={15} />}>
              <label className={`${labelClass} sm:col-span-2`}>URL MJPEG, RTSP o índice local<input className={inputClass} defaultValue={config.camera_url} name="camera_url" required /></label>
              <label className={`${labelClass} sm:col-span-2`}>URL de respaldo<input className={inputClass} defaultValue={config.camera_fallback_url || ""} name="camera_fallback_url" placeholder="Tailscale u otra ruta alternativa" /></label>
              <label className={labelClass}>Nombre visible<input className={inputClass} defaultValue={config.camera_label} name="camera_label" required /></label>
              <label className={labelClass}>Identificador<input className={inputClass} defaultValue={config.camera_id} name="camera_id" required /></label>
              <label className={labelClass}>Área útil desde (%)<input className={inputClass} defaultValue={Number((config.camera_roi_left * 100).toFixed(1))} name="camera_roi_left" type="number" min="0" max="90" step="0.1" /></label>
              <label className={labelClass}>Área útil hasta (%)<input className={inputClass} defaultValue={Number((config.camera_roi_right * 100).toFixed(1))} name="camera_roi_right" type="number" min="10" max="100" step="0.1" /></label>
              <p className="text-[9px] leading-4 text-zinc-400 sm:col-span-2">Solo esta franja entra a SCRFD. Las zonas laterales sombreadas no generan recortes.</p>
            </CameraSection>

            <CameraSection title="Cámara Dahua" detail="Segunda fuente RTSP procesada en paralelo." icon={<Wifi size={15} />}>
              <label className={labelClass}>Estado<select className={inputClass} defaultValue={String(config.secondary_camera_enabled)} name="secondary_camera_enabled"><option value="false">Desactivada</option><option value="true">Activada</option></select></label>
              <label className={labelClass}>Nombre visible<input className={inputClass} defaultValue={config.secondary_camera_label || ""} name="secondary_camera_label" /></label>
              <label className={`${labelClass} sm:col-span-2`}>URL RTSP sin credenciales<input className={inputClass} defaultValue={config.secondary_camera_url || ""} name="secondary_camera_url" placeholder="rtsp://IP:554/cam/realmonitor?..." /></label>
              <label className={labelClass}>Usuario RTSP<input className={inputClass} defaultValue={config.secondary_camera_username || ""} name="secondary_camera_username" autoComplete="username" /></label>
              <label className={labelClass}>Contraseña RTSP<input className={inputClass} name="secondary_camera_password" type="password" autoComplete="new-password" placeholder="Vacío conserva la actual" /></label>
              <label className={`${labelClass} sm:col-span-2`}>Identificador<input className={inputClass} defaultValue={config.secondary_camera_id || ""} name="secondary_camera_id" /></label>
              <label className={labelClass}>Área útil desde (%)<input className={inputClass} defaultValue={Number((config.secondary_camera_roi_left * 100).toFixed(1))} name="secondary_camera_roi_left" type="number" min="0" max="90" step="0.1" /></label>
              <label className={labelClass}>Área útil hasta (%)<input className={inputClass} defaultValue={Number((config.secondary_camera_roi_right * 100).toFixed(1))} name="secondary_camera_roi_right" type="number" min="10" max="100" step="0.1" /></label>
            </CameraSection>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 lg:col-span-2">
              <h3 className="flex items-center gap-2 text-xs font-bold text-zinc-800"><Cpu size={15} className="text-emerald-700" /> Procesamiento</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelClass}>Procesador<select className={inputClass} defaultValue={config.processing_device} name="processing_device"><option value="auto">Automático</option><option value="gpu">GPU NVIDIA</option><option value="cpu">CPU</option></select></label>
                <label className={labelClass}>SCRFD detector<select className={inputClass} defaultValue={config.detector_size} name="detector_size">{[320, 480, 640, 960, 1280].map((size) => <option key={size} value={size}>{size}×{size}</option>)}</select></label>
                <label className={labelClass}>Calidad recorte JPEG<input className={inputClass} defaultValue={config.spool_jpeg_quality} name="spool_jpeg_quality" type="number" min="85" max="100" step="1" /></label>
                <label className={labelClass}>Ancho vista previa<input className={inputClass} defaultValue={config.preview_width} name="preview_width" type="number" min="320" max="1920" step="160" /></label>
                <label className={labelClass}>Inicio del lote nocturno<input className={inputClass} defaultValue={config.night_batch_start_time} name="night_batch_start_time" type="time" step="60" required /></label>
                <label className={labelClass}>Lote ArcFace<select className={inputClass} defaultValue={config.night_embedding_batch_size} name="night_embedding_batch_size">{[1, 8, 16, 32, 64].map((size) => <option key={size} value={size}>{size === 1 ? "1 · modo anterior" : `${size} rostros`}</option>)}</select></label>
                <label className={labelClass}>Umbral registrados<input className={inputClass} defaultValue={config.known_threshold} name="known_threshold" type="number" min="-1" max="1" step="0.01" /></label>
                <label className={labelClass}>Umbral desconocidos<input className={inputClass} defaultValue={config.unknown_threshold} name="unknown_threshold" type="number" min="-1" max="1" step="0.01" /></label>
                <label className={labelClass}>Confirmación secundaria<input className={inputClass} defaultValue={config.unknown_confirmation_threshold} name="unknown_confirmation_threshold" type="number" min="-1" max="1" step="0.01" /></label>
                <label className={labelClass}>Evidencias por persona / día<input className={inputClass} defaultValue={config.daily_evidence_limit} name="daily_evidence_limit" type="number" min="12" max="100" step="1" /></label>
                <label className={labelClass}>Ventana de auditoría<input className={inputClass} defaultValue={config.evidence_safety_days} name="evidence_safety_days" type="number" min="1" max="90" step="1" /></label>
              </div>
              <input defaultValue={config.processing_width} name="processing_width" type="hidden" />
              <input defaultValue={config.target_fps} name="target_fps" type="hidden" />
              <p className="mt-3 text-[10px] leading-4 text-zinc-500">SCRFD analiza una entrada reducida, pero cada recorte sale del frame original. Al terminar el lote se conservan hasta {config.daily_evidence_limit} evidencias representativas por persona y día; los redundantes permanecen {config.evidence_safety_days} días completos antes de pasar por una cuarentena reversible.</p>
            </section>
          </div>
        ) : null}
        <footer className="flex justify-end gap-2 border-t border-zinc-200 bg-white px-5 py-4">
          <Button onClick={onClose} type="button">Cancelar</Button>
          <Button disabled={!config || saving} tone="primary" type="submit" data-testid="settings-save">{saving ? "Guardando..." : "Guardar y reiniciar"}</Button>
        </footer>
      </form>
    </div>
  );
}

function CameraSection({ title, detail, icon, children }: { title: string; detail: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h3 className="flex items-center gap-2 text-xs font-bold text-zinc-800"><span className="text-emerald-700">{icon}</span>{title}</h3>
      <p className="mt-1 text-[10px] text-zinc-500">{detail}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}
