import { type FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, MapPin, Pencil, Plus, Power, Search, UsersRound, X } from "lucide-react";
import type { AppData, TrialAvailabilityRule } from "../../types";
import {
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  weekdayLabels,
  type AvailabilityActions,
} from "./model";

export function AvailabilityPanel({
  data,
  onCreateRule,
  onUpdateRule,
}: { data: AppData } & AvailabilityActions) {
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [editor, setEditor] = useState<TrialAvailabilityRule | "new" | null>(null);

  const filteredRules = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return [...data.trialAvailabilityRules]
      .filter((rule) => site === "all" || String(rule.site) === site)
      .filter((rule) => activeFilter === "all" || (activeFilter === "active" ? rule.is_active : !rule.is_active))
      .filter((rule) => {
        if (!needle) return true;
        return [rule.site_name, rule.court_name, weekdayLabels[rule.weekday] ?? ""]
          .some((value) => value.toLocaleLowerCase("es-MX").includes(needle));
      })
      .sort((left, right) => {
        if (left.site_name !== right.site_name) return left.site_name.localeCompare(right.site_name, "es-MX");
        if (left.weekday !== right.weekday) return left.weekday - right.weekday;
        return left.starts_at.localeCompare(right.starts_at);
      });
  }, [activeFilter, data.trialAvailabilityRules, query, site]);

  const activeRules = data.trialAvailabilityRules.filter((rule) => rule.is_active).length;
  const activeSites = new Set(data.trialAvailabilityRules.filter((rule) => rule.is_active).map((rule) => rule.site)).size;

  return (
    <div className="grid min-w-0 gap-4">
      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Agenda del agente</p>
            <h3 className="mt-1 text-lg font-semibold">Horarios ofrecidos para pruebas gratuitas</h3>
            <p className="mt-1 text-sm opacity-75">
              {activeRules} reglas activas en {activeSites} {activeSites === 1 ? "sede" : "sedes"}. La capacidad se aplica por horario.
            </p>
          </div>
          <button className={primaryButtonClass} disabled={!data.sites.length} onClick={() => setEditor("new")} type="button">
            <Plus size={16} /> Agregar disponibilidad
          </button>
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_200px_180px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={17} />
            <input
              className={`${inputClass} pl-9`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar sede, cancha o día"
              type="search"
              value={query}
            />
          </label>
          <select className={inputClass} onChange={(event) => setSite(event.target.value)} value={site}>
            <option value="all">Todas las sedes</option>
            {data.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className={inputClass} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)} value={activeFilter}>
            <option value="all">Activos e inactivos</option>
            <option value="active">Solo activos</option>
            <option value="inactive">Solo inactivos</option>
          </select>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {filteredRules.map((rule) => (
          <article
            className={`motion-card rounded-md border bg-white p-4 shadow-sm dark:bg-zinc-950 ${
              rule.is_active ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200 opacity-65 dark:border-zinc-800"
            }`}
            key={rule.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{weekdayLabels[rule.weekday] ?? `Día ${rule.weekday}`}</h3>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    rule.is_active
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}>
                    {rule.is_active ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-300"><MapPin size={14} /> {rule.site_name}</p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{rule.court_name || "Cualquier cancha disponible"}</p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <Clock3 size={17} />
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <RuleDetail label="Horario" value={`${shortTime(rule.starts_at)}–${shortTime(rule.ends_at)}`} />
              <RuleDetail label="Duración" value={`${rule.slot_minutes} min`} />
              <RuleDetail label="Capacidad" value={String(rule.capacity)} icon />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className={secondaryButtonClass} onClick={() => setEditor(rule)} type="button">
                <Pencil size={15} /> Editar
              </button>
              <button
                className={`${secondaryButtonClass} ${rule.is_active ? "" : "border-emerald-200 text-emerald-700 dark:text-emerald-300"}`}
                onClick={() => void onUpdateRule(rule, { is_active: !rule.is_active })}
                type="button"
              >
                <Power size={15} /> {rule.is_active ? "Desactivar" : "Activar"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {!filteredRules.length ? (
        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
          <Clock3 className="mx-auto text-zinc-400" size={28} />
          <p className="mt-3 font-semibold text-zinc-800 dark:text-zinc-100">
            {data.trialAvailabilityRules.length ? "No hay horarios con estos filtros" : "Configura la disponibilidad del agente"}
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Sin horarios activos, el agente no ofrecerá citas nuevas.
          </p>
          {!data.trialAvailabilityRules.length && data.sites.length ? (
            <button className={`${primaryButtonClass} mt-4`} onClick={() => setEditor("new")} type="button"><Plus size={16} /> Crear primer horario</button>
          ) : null}
        </div>
      ) : null}

      {editor ? (
        <AvailabilityEditor
          data={data}
          rule={editor === "new" ? null : editor}
          onClose={() => setEditor(null)}
          onSave={async (payload) => {
            if (editor === "new") await onCreateRule(payload);
            else await onUpdateRule(editor, payload);
            setEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AvailabilityEditor({
  data,
  rule,
  onClose,
  onSave,
}: {
  data: AppData;
  rule: TrialAvailabilityRule | null;
  onClose: () => void;
  onSave: (payload: unknown) => Promise<void>;
}) {
  const defaultSite = rule?.site ?? data.sites[0]?.id ?? 0;
  const [form, setForm] = useState({
    site: String(defaultSite),
    court: rule?.court ? String(rule.court) : "",
    weekday: String(rule?.weekday ?? 0),
    starts_at: shortTime(rule?.starts_at ?? "16:00"),
    ends_at: shortTime(rule?.ends_at ?? "20:00"),
    slot_minutes: String(rule?.slot_minutes ?? 60),
    capacity: String(rule?.capacity ?? 1),
    is_active: rule?.is_active ?? true,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const courts = data.courts.filter((court) => String(court.site) === form.site && court.is_active);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.ends_at <= form.starts_at) {
      setError("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        site: Number(form.site),
        court: form.court ? Number(form.court) : null,
        weekday: Number(form.weekday),
        starts_at: form.starts_at,
        ends_at: form.ends_at,
        slot_minutes: Number(form.slot_minutes),
        capacity: Number(form.capacity),
        is_active: form.is_active,
      });
    } finally {
      setSaving(false);
    }
  }

  function updateSite(nextSite: string) {
    setForm({ ...form, site: nextSite, court: "" });
  }

  return createPortal(
    <div className="fixed inset-0 z-[1300] flex items-start justify-center overflow-y-auto bg-zinc-950/55 px-3 py-6">
      <form className="motion-card w-full max-w-2xl overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onSubmit={submit}>
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Disponibilidad de pruebas</p>
            <h3 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">{rule ? "Editar horario" : "Agregar horario"}</h3>
          </div>
          <button aria-label="Cerrar" className={secondaryButtonClass} onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <div className="grid gap-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sede" required>
              <select className={inputClass} required value={form.site} onChange={(event) => updateSite(event.target.value)}>
                {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
            </Field>
            <Field label="Cancha">
              <select className={inputClass} value={form.court} onChange={(event) => setForm({ ...form, court: event.target.value })}>
                <option value="">Cualquier cancha</option>
                {courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
              </select>
            </Field>
            <Field label="Día" required>
              <select className={inputClass} required value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
                {weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
              </select>
            </Field>
            <Field label="Capacidad por horario" required>
              <input className={inputClass} min={1} required type="number" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
            </Field>
            <Field label="Hora de inicio" required>
              <input className={inputClass} required type="time" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} />
            </Field>
            <Field label="Hora de fin" required>
              <input className={inputClass} required type="time" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} />
            </Field>
            <Field label="Duración de cada cita (min)" required>
              <input className={inputClass} min={15} required step={5} type="number" value={form.slot_minutes} onChange={(event) => setForm({ ...form, slot_minutes: event.target.value })} />
            </Field>
            <label className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              <input checked={form.is_active} className="size-4 accent-emerald-700" onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" />
              Horario activo
            </label>
          </div>
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:flex-row sm:justify-end">
            <button className={secondaryButtonClass} disabled={saving} onClick={onClose} type="button">Cancelar</button>
            <button className={primaryButtonClass} disabled={saving || !form.site} type="submit">{saving ? "Guardando..." : rule ? "Guardar cambios" : "Crear horario"}</button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-200">{label}{required ? " *" : ""}</span>
      {children}
    </label>
  );
}

function RuleDetail({ label, value, icon = false }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-md bg-zinc-50 px-2 py-2 dark:bg-zinc-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        {icon ? <UsersRound size={13} /> : null}{value}
      </p>
    </div>
  );
}

function shortTime(value: string) {
  return value.slice(0, 5);
}
