import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import type { Site, WhatsAppAutomationSettings } from "../../types";
import { WhatsAppAutomationSettingsPanel } from "./WhatsAppAutomationSettingsPanel";
import { inputClass, secondaryButtonClass } from "./model";

const endpoint = "/whatsapp-automation-settings/";
export function WhatsAppSiteSettings({ token, sites, initial }: {
  token: string; sites: Site[]; initial: WhatsAppAutomationSettings | null;
}) {
  const [options, setOptions] = useState<WhatsAppAutomationSettings[]>([]);
  const [address, setAddress] = useState(initial?.business_address ?? "");
  const [value, setValue] = useState<WhatsAppAutomationSettings | null>(null);
  const [phone, setPhone] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<WhatsAppAutomationSettings[]>(endpoint, token, { signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) { setOptions(rows); setAddress(current => current || rows[0]?.business_address || ""); setLoading(false); } })
      .catch(err => { if (!controller.signal.aborted) { setError(String(err.message)); setLoading(false); } });
    return () => controller.abort();
  }, [token, retry]);
  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    setLoading(true); setValue(null); setError("");
    apiRequest<WhatsAppAutomationSettings>(endpoint + "current/?business_address=" + encodeURIComponent(address), token, { signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) { setValue(next); setDirty(false); } })
      .catch(err => { if (!controller.signal.aborted) setError(String(err.message)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [address, token, retry]);
  function select(next: string) {
    if (saving || next === address) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos y cambiar de número?")) return;
    setDirty(false); setAddress(next);
  }
  return <div className="grid gap-4">
    <section className="comm-panel">
      <header className="comm-section-heading"><div><h3>Configuración por sede y número</h3><p>Selecciona el canal que quieres editar. No cambia la configuración de los demás.</p></div></header>
      <div className="comm-stats-body grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Número / sede
          <select className={inputClass} value={address} disabled={saving} onChange={e => select(e.target.value)}>
            {!address && <option value="">Selecciona un número</option>}
            {address && !options.some(item => item.business_address === address) && <option value={address}>{address} · Nuevo</option>}
            {options.map(item => <option key={item.business_address} value={item.business_address}>{item.site_name || "Sin sede vinculada"} · {item.business_address.replace("whatsapp:", "")}</option>)}
          </select>
        </label>
        <div className="grid gap-2"><label className="grid gap-1 text-sm font-semibold">Configurar otro número
          <input className={inputClass} type="tel" placeholder="+52..." value={phone} onChange={e => setPhone(e.target.value)} />
        </label><button type="button" className={secondaryButtonClass} disabled={saving || !/^\+[1-9]\d{7,14}$/.test(phone.trim())} onClick={() => select("whatsapp:" + phone.trim())}>Preparar configuración</button></div>
        <p className="text-sm sm:col-span-2">Guardar aquí no conecta un número a WhatsApp. El canal debe estar dado de alta en Dualhook y en el servicio correspondiente. El número de Verónica sigue siendo de atención manual.</p>
      </div>
    </section>
    {error && <div role="alert" className="comm-reference"><p className="comm-error">{error}</p><button type="button" onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
    {loading ? <p role="status">Cargando configuración…</p> : value && <div><WhatsAppAutomationSettingsPanel key={address} value={value} sites={sites} onDirtyChange={setDirty} onSave={async payload => {
      setSaving(true);
      try {
        const next = await apiRequest<WhatsAppAutomationSettings>(endpoint + "current/?business_address=" + encodeURIComponent(address), token, { method: "PATCH", body: JSON.stringify(payload) });
        setValue(next); setDirty(false);
        setOptions(rows => [...rows.filter(item => item.business_address !== next.business_address), next]);
        return true;
      } finally { setSaving(false); }
    }} /></div>}
  </div>;
}
