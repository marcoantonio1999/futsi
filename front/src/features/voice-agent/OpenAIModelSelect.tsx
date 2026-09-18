import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import { inputClass } from "./model";

type Model = { id: string; selectable: boolean };

export function OpenAIModelSelect({ token, value, savedModel, disabled, onChange }: {
  token?: string;
  value: string;
  savedModel: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setModels([]);
    if (!token) { setError("No se pudo consultar el catálogo sin una sesión activa."); setLoading(false); return; }
    apiRequest<{ models: Model[] }>("/whatsapp-automation-settings/models/", token, { signal: controller.signal })
      .then(result => {
        if (!Array.isArray(result.models)) throw new Error("El servidor no devolvió un catálogo válido.");
        if (!controller.signal.aborted) setModels(result.models);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudo cargar el catálogo."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, revision]);
  const available = models.filter(model => model.selectable);
  const unsupported = models.filter(model => !model.selectable);
  const currentAvailable = available.some(model => model.id === value);
  return <div className="grid content-start gap-2">
    <label className="grid gap-1 text-sm font-semibold">Modelo de OpenAI
      <select className={inputClass} aria-label="Modelo de OpenAI" required value={value}
        disabled={disabled || loading || Boolean(error)} onChange={e => onChange(e.target.value)}>
        <option value="" disabled>{loading ? "Cargando modelos…" : "Selecciona un modelo"}</option>
        {value && !currentAvailable && <option value={value}>{value} · Actual (no verificado en el catálogo)</option>}
        <optgroup label="Disponibles para el asistente">
          {available.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}
        </optgroup>
        {unsupported.length > 0 && <optgroup label="Otros modelos de la cuenta · no habilitados para este chat">
          {unsupported.filter(model => model.id !== value).map(model => <option key={model.id} value={model.id} disabled>{model.id}</option>)}
        </optgroup>}
      </select>
    </label>
    <p className="text-xs">Guardado: {savedModel || "Heredado del servidor"}. Elegir otro modelo solo se aplica al guardar esta sede.</p>
    <p className="text-xs">Se consulta la cuenta de API configurada en el servidor. Los modelos especializados o sin compatibilidad confirmada aparecen deshabilitados. Cada modelo tiene su propio costo.</p>
    {loading && <p role="status" className="text-xs">Consultando modelos de OpenAI…</p>}
    {error && <p role="alert" className="comm-error text-sm">{error} Se conserva el modelo actual.</p>}
    {!loading && !error && !available.length && <p role="status" className="text-sm">No hay modelos compatibles en el catálogo de esta cuenta.</p>}
    {!loading && !error && value && !currentAvailable && <p className="text-sm">El modelo actual no aparece entre los habilitados. Puedes conservarlo o seleccionar otro; no se cambia automáticamente.</p>}
    <button type="button" className="justify-self-start text-sm font-semibold underline" disabled={disabled || loading}
      onClick={() => setRevision(n => n + 1)}>Actualizar modelos</button>
  </div>;
}
