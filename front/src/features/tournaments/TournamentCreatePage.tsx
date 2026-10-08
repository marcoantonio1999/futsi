import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Trophy } from "lucide-react";
import type { AppData, Tournament } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";
import { today } from "./utils";

export function TournamentCreatePage({ sites, onBack, onCreate, onCreated }: { sites: Pick<AppData["sites"][number], "id" | "name">[]; onBack: () => void; onCreate: (payload: unknown) => Promise<unknown>; onCreated: (tournament: Tournament) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current) return;
    const form = new FormData(event.currentTarget);
    saving.current = true; setBusy(true); setError("");
    try {
      const created = await onCreate({ name: String(form.get("name")).trim(), site: Number(form.get("site")), starts_on: form.get("starts_on"), expected_weeks: Number(form.get("expected_weeks")), billing_type: "weekly_match", is_active: true }) as Tournament;
      onCreated(created);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el torneo."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="tournament-create" data-testid="tournament-create-page">
    <button type="button" className="tournament-back" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Torneos activos</button>
    <form onSubmit={submit} className="tournament-create-card">
      <fieldset disabled={busy || !sites.length}>
        <legend className="sr-only">Datos del nuevo torneo</legend>
        <header className="tournament-create-heading">
          <span className="tournament-create-icon"><Trophy size={21} /></span>
          <div><h2>Datos del torneo</h2><p>Completa estos datos. Después podrás agregar los equipos.</p></div>
        </header>
        <div className="tournament-form-grid">
          <TextInput label="Nombre del torneo" name="name" maxLength={160} placeholder="Ej. Copa Colegio Franco" required />
          <SelectInput label="Sede" name="site" required defaultValue={sites.length === 1 ? sites[0].id : ""}>
            <option value="" disabled>Selecciona una sede</option>
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </SelectInput>
          <TextInput label="Fecha de inicio" name="starts_on" type="date" defaultValue={today()} required />
          <TextInput label="Duración prevista (semanas)" name="expected_weeks" type="number" min={1} step={1} defaultValue={12} required />
        </div>
        {error && <p className="tournament-feedback error" role="alert">{error}</p>}
        {!sites.length && <p className="tournament-feedback warning">Primero necesitas una sede registrada para crear el torneo.</p>}
        <footer className="tournament-actions">
          <button type="button" className="tournament-button secondary" onClick={onBack}>Cancelar</button>
          <button type="submit" className="tournament-button primary" disabled={busy || !sites.length}>{busy ? "Creando torneo…" : "Crear torneo"}</button>
        </footer>
      </fieldset>
    </form>
  </div>;
}
