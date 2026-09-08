import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import type { AppData, Tournament } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";
import { today } from "./utils";

export function TournamentCreatePage({ sites, onBack, onCreate, onCreated }: { sites: AppData["sites"]; onBack: () => void; onCreate: (payload: unknown) => Promise<unknown>; onCreated: (tournament: Tournament) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current) return;
    const form = new FormData(event.currentTarget);
    saving.current = true; setBusy(true); setError("");
    try {
      const created = await onCreate({ name: String(form.get("name")).trim(), site: Number(form.get("site")), starts_on: form.get("starts_on"), expected_weeks: Number(form.get("expected_weeks")), billing_type: form.get("billing_type"), is_active: true }) as Tournament;
      onCreated(created);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el torneo."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="tournament-create" data-testid="tournament-create-page"><button className="tournament-back" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Torneos activos</button><header className="tournament-page-heading"><div><p className="tournament-eyebrow">Torneos / Nuevo</p><h2>Crear torneo</h2><p>Después podrás crear sus equipos, inscribir alumnos y agendar partidos.</p></div></header>
    <form onSubmit={submit}><fieldset disabled={busy || !sites.length}><legend className="sr-only">Datos del nuevo torneo</legend><section className="tournament-surface tournament-form-section"><h3><Trophy size={18} />Datos del torneo</h3><TextInput label="Nombre del torneo" name="name" maxLength={160} placeholder="Ej. Copa Futsi Sub-12" required /><div className="tournament-form-grid"><SelectInput label="Sede" name="site" required defaultValue=""><option value="" disabled>Selecciona una sede</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput><TextInput label="Fecha de inicio" name="starts_on" type="date" defaultValue={today()} required /></div></section><section className="tournament-surface tournament-form-section"><h3>Duración y forma de cobro</h3><div className="tournament-form-grid"><TextInput label="Semanas previstas" name="expected_weeks" type="number" min={1} step={1} defaultValue={12} required /><SelectInput label="Plan de pago predeterminado" name="billing_type" defaultValue="weekly_match"><option value="weekly_match">Pago semanal</option><option value="full_tournament">Torneo completo</option></SelectInput></div><p className="tournament-muted">El importe se define al inscribir a cada alumno.</p></section>{error && <p className="tournament-feedback error" role="alert">{error}</p>}<div className="tournament-actions"><button type="button" className="tournament-button secondary" onClick={onBack}>Cancelar</button><button className="tournament-button primary" disabled={busy || !sites.length}>{busy ? "Creando torneo…" : "Crear torneo"}</button></div></fieldset></form>{!sites.length && <p className="tournament-feedback warning">Primero necesitas una sede registrada para crear el torneo.</p>}
  </div>;
}
