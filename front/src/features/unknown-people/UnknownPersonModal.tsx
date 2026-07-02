import { FormEvent, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { EvidenceImage } from "../automatic-attendance";
import { qualityText, type RegisteredUnknownPerson, type UnknownSubject } from "../unknown-attendance/model";

type PersonType = "player" | "student";

export function UnknownPersonModal({ subject, token, data, onClose, onRegistered }: { subject: UnknownSubject; token: string; data: AppData; onClose: () => void; onRegistered: (result: RegisteredUnknownPerson) => void }) {
  const activeTeams = useMemo(() => data.teams.filter((team) => team.is_active !== false), [data.teams]);
  const [personType, setPersonType] = useState<PersonType>("player");
  const [form, setForm] = useState({
    full_name: "",
    team_id: activeTeams[0]?.id ? String(activeTeams[0].id) : "",
    site_id: subject.site_id ? String(subject.site_id) : data.sites[0]?.id ? String(data.sites[0].id) : "",
    phone: "",
    email: "",
    guardian_name: "",
    guardian_phone: "",
    category: "",
    group_name: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest<RegisteredUnknownPerson>(`/unknown-attendance/subjects/${encodeURIComponent(subject.id)}/register-person/`, token, {
        method: "POST",
        body: JSON.stringify({ ...form, person_type: personType }),
      });
      onRegistered(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la persona.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-zinc-950/55 px-3 py-6">
      <form onSubmit={submit} className="motion-card w-full max-w-3xl rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Registrar desconocido</p>
            <h3 className="mt-1 break-words text-lg font-semibold text-zinc-950 dark:text-zinc-50">{subject.temporary_name}</h3>
          </div>
          <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[260px_1fr]">
          <div>
            <EvidenceImage url={subject.image_url} token={token} fit="contain" ratio="square" />
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{qualityText(subject.metadata?.quality)}</p>
          </div>
          <div className="grid gap-3">
            <Field label="Nombre completo" required value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">Tipo de persona</span>
              <select className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" value={personType} onChange={(event) => setPersonType(event.target.value as PersonType)}>
                <option value="player">Jugador adulto</option>
                <option value="student">Alumno academia</option>
              </select>
            </label>
            {personType === "player" ? (
              <>
                <SelectField label="Equipo" required value={form.team_id} onChange={(value) => setForm({ ...form, team_id: value })}>
                  <option value="">Seleccionar equipo</option>
                  {activeTeams.map((team) => <option key={team.id} value={team.id}>{team.name} - {team.tournament_name || "Torneo"}</option>)}
                </SelectField>
                <Field label="Telefono" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
              </>
            ) : (
              <>
                <SelectField label="Sede" required value={form.site_id} onChange={(value) => setForm({ ...form, site_id: value })}>
                  <option value="">Seleccionar sede</option>
                  {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </SelectField>
                <Field label="Tutor" required value={form.guardian_name} onChange={(value) => setForm({ ...form, guardian_name: value })} />
                <Field label="Telefono tutor" required value={form.guardian_phone} onChange={(value) => setForm({ ...form, guardian_phone: value })} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Categoria" value={form.category} onChange={(value) => setForm({ ...form, category: value })} />
                  <Field label="Grupo" value={form.group_name} onChange={(value) => setForm({ ...form, group_name: value })} />
                </div>
              </>
            )}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950" disabled={saving} type="submit">
              {saving ? "Registrando..." : "Guardar persona nueva"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      <input className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" required={required} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, required = false, children }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
      <select className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" required={required} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}
