import { type FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Mail, MapPin, Pencil, Phone, Search, UserRound, X } from "lucide-react";
import type { AppData, TrialBooking, TrialBookingSource, TrialBookingStatus, TrialVisit, TrialVisitStatus } from "../../types";
import {
  formatDateTime,
  formatShortDate,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  toDateTimeInput,
  toIsoDateTime,
  type BookingActions,
} from "./model";

const bookingStatusLabels: Record<TrialBookingStatus, string> = {
  scheduled: "Agendada",
  in_progress: "En curso",
  completed: "Completada",
  canceled: "Cancelada",
};

const visitStatusLabels: Record<TrialVisitStatus, string> = {
  scheduled: "Agendada",
  completed: "Completada",
  no_show: "No asistió",
  canceled: "Cancelada",
};

const sourceLabels: Record<TrialBookingSource, string> = {
  voice: "Llamada",
  whatsapp: "WhatsApp",
  manual: "Manual",
  web: "Web",
};

export function TrialBookingsPanel({
  data,
  onUpdateBooking,
  onUpdateVisit,
}: { data: AppData } & BookingActions) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | TrialBookingStatus>("all");
  const [site, setSite] = useState("all");
  const [editingBooking, setEditingBooking] = useState<TrialBooking | null>(null);
  const [editingVisit, setEditingVisit] = useState<TrialVisit | null>(null);

  const filteredBookings = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return [...data.trialBookings]
      .filter((booking) => status === "all" || booking.status === status)
      .filter((booking) => site === "all" || String(booking.site) === site)
      .filter((booking) => {
        if (!needle) return true;
        return [
          booking.responsible_name,
          booking.responsible_phone,
          booking.responsible_email,
          booking.child_first_name,
          booking.site_name,
        ].some((value) => value.toLocaleLowerCase("es-MX").includes(needle));
      })
      .sort((left, right) => {
        const leftNext = nextScheduledVisit(left)?.starts_at ?? left.created_at;
        const rightNext = nextScheduledVisit(right)?.starts_at ?? right.created_at;
        return new Date(leftNext).getTime() - new Date(rightNext).getTime();
      });
  }, [data.trialBookings, query, site, status]);

  const scheduled = data.trialBookings.filter((booking) => booking.status === "scheduled").length;
  const completed = data.trialBookings.filter((booking) => booking.status === "completed").length;
  const noShowVisits = data.trialBookings.flatMap((booking) => booking.visits).filter((visit) => visit.status === "no_show").length;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniMetric label="Reservas agendadas" value={scheduled} tone="emerald" />
        <MiniMetric label="Pruebas completadas" value={completed} tone="blue" />
        <MiniMetric label="Inasistencias" value={noShowVisits} tone="amber" />
      </div>

      <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_200px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={17} />
            <input
              className={`${inputClass} pl-9`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar niño, responsable o teléfono"
              type="search"
              value={query}
            />
          </label>
          <select className={inputClass} onChange={(event) => setStatus(event.target.value as typeof status)} value={status}>
            <option value="all">Todos los estados</option>
            {Object.entries(bookingStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className={inputClass} onChange={(event) => setSite(event.target.value)} value={site}>
            <option value="all">Todas las sedes</option>
            {data.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </section>

      <div className="grid gap-3">
        {filteredBookings.map((booking) => (
          <BookingCard
            booking={booking}
            key={booking.id}
            onEditBooking={() => setEditingBooking(booking)}
            onEditVisit={setEditingVisit}
          />
        ))}
        {!filteredBookings.length ? (
          <EmptyState
            title={data.trialBookings.length ? "No hay resultados con estos filtros" : "Aún no hay pruebas agendadas"}
            text={data.trialBookings.length ? "Cambia la búsqueda o los filtros." : "Las citas que confirme el agente aparecerán aquí con sus dos visitas."}
          />
        ) : null}
      </div>

      {editingBooking ? (
        <BookingEditor
          booking={editingBooking}
          onClose={() => setEditingBooking(null)}
          onSave={async (payload) => {
            await onUpdateBooking(editingBooking, payload);
            setEditingBooking(null);
          }}
        />
      ) : null}

      {editingVisit ? (
        <VisitEditor
          courts={data.courts}
          visit={editingVisit}
          onClose={() => setEditingVisit(null)}
          onSave={async (payload) => {
            await onUpdateVisit(editingVisit, payload);
            setEditingVisit(null);
          }}
        />
      ) : null}
    </div>
  );
}

function BookingCard({
  booking,
  onEditBooking,
  onEditVisit,
}: {
  booking: TrialBooking;
  onEditBooking: () => void;
  onEditVisit: (visit: TrialVisit) => void;
}) {
  const visits = [...booking.visits].sort((left, right) => left.visit_number - right.visit_number);
  const nextVisit = nextScheduledVisit(booking);

  return (
    <article className="motion-card overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{booking.child_first_name || "Nombre por completar"}</h3>
            <BookingStatus status={booking.status} />
            <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-200">
              {sourceLabels[booking.source]}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1"><UserRound size={14} /> Responsable: {booking.responsible_name}</span>
            <span className="inline-flex items-center gap-1"><MapPin size={14} /> {booking.site_name}</span>
            {booking.child_age ? <span>{booking.child_age} años</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300" href={`tel:${booking.responsible_phone}`}>
              <Phone size={14} /> {booking.responsible_phone}
            </a>
            {booking.responsible_email ? (
              <a className="inline-flex items-center gap-1 text-zinc-600 hover:underline dark:text-zinc-300" href={`mailto:${booking.responsible_email}`}>
                <Mail size={14} /> {booking.responsible_email}
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {nextVisit ? `Próxima: ${formatDateTime(nextVisit.starts_at)}` : "Sin visitas próximas"}
          </p>
          <button className={secondaryButtonClass} onClick={onEditBooking} type="button">
            <Pencil size={15} /> Editar datos
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2">
        {[1, 2].map((visitNumber) => {
          const visit = visits.find((item) => item.visit_number === visitNumber);
          return visit ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/70" key={visit.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Visita {visit.visit_number}</p>
                  <p className="mt-1 font-semibold text-zinc-950 dark:text-zinc-50">{formatShortDate(visit.starts_at)}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{formatDateTime(visit.starts_at).split(", ").slice(-1)[0]}</p>
                </div>
                <VisitStatus status={visit.status} />
              </div>
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {visit.court_name || "Cancha por asignar"} · termina {formatDateTime(visit.ends_at).split(", ").slice(-1)[0]}
              </p>
              <button className={`${secondaryButtonClass} mt-3 w-full`} onClick={() => onEditVisit(visit)} type="button">
                <CalendarClock size={15} /> Editar visita
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200" key={visitNumber}>
              Visita {visitNumber} pendiente de definir.
            </div>
          );
        })}
      </div>
      {booking.notes ? (
        <p className="border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
          <span className="font-semibold">Notas:</span> {booking.notes}
        </p>
      ) : null}
    </article>
  );
}

function BookingEditor({
  booking,
  onClose,
  onSave,
}: {
  booking: TrialBooking;
  onClose: () => void;
  onSave: (payload: unknown) => Promise<void>;
}) {
  const [form, setForm] = useState({
    responsible_name: booking.responsible_name,
    responsible_phone: booking.responsible_phone,
    responsible_email: booking.responsible_email,
    child_first_name: booking.child_first_name,
    child_age: booking.child_age ? String(booking.child_age) : "",
    status: booking.status,
    notes: booking.notes,
  });
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        child_age: form.child_age ? Number(form.child_age) : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <Modal title={`Editar prueba de ${booking.child_first_name}`} eyebrow={booking.site_name} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Responsable" required>
            <input className={inputClass} required value={form.responsible_name} onChange={(event) => setForm({ ...form, responsible_name: event.target.value })} />
          </Field>
          <Field label="Teléfono" required>
            <input className={inputClass} required type="tel" value={form.responsible_phone} onChange={(event) => setForm({ ...form, responsible_phone: event.target.value })} />
          </Field>
          <Field label="Correo">
            <input className={inputClass} type="email" value={form.responsible_email} onChange={(event) => setForm({ ...form, responsible_email: event.target.value })} />
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TrialBookingStatus })}>
              {Object.entries(bookingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Nombre del niño" required>
            <input className={inputClass} required value={form.child_first_name} onChange={(event) => setForm({ ...form, child_first_name: event.target.value })} />
          </Field>
          <Field label="Edad">
            <input className={inputClass} max={17} min={3} type="number" value={form.child_age} onChange={(event) => setForm({ ...form, child_age: event.target.value })} />
          </Field>
        </div>
        <Field label="Notas">
          <textarea className={`${inputClass} min-h-24 resize-y`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
        <ModalActions saving={saving} onClose={onClose} />
      </form>
    </Modal>,
    document.body,
  );
}

function VisitEditor({
  courts,
  visit,
  onClose,
  onSave,
}: {
  courts: AppData["courts"];
  visit: TrialVisit;
  onClose: () => void;
  onSave: (payload: unknown) => Promise<void>;
}) {
  const [form, setForm] = useState({
    starts_at: toDateTimeInput(visit.starts_at),
    ends_at: toDateTimeInput(visit.ends_at),
    court: visit.court ? String(visit.court) : "",
    status: visit.status,
    notes: visit.notes,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const availableCourts = courts.filter((court) => court.site === visit.site && court.is_active);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const startsAt = new Date(form.starts_at);
    const endsAt = new Date(form.ends_at);
    if (endsAt <= startsAt) {
      setError("La hora de fin debe ser posterior a la hora de inicio.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        starts_at: toIsoDateTime(form.starts_at),
        ends_at: toIsoDateTime(form.ends_at),
        court: form.court ? Number(form.court) : null,
        status: form.status,
        notes: form.notes,
      });
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <Modal title={`Editar visita ${visit.visit_number}`} eyebrow={visit.site_name} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inicio" required>
            <input className={inputClass} required type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} />
          </Field>
          <Field label="Fin" required>
            <input className={inputClass} required type="datetime-local" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} />
          </Field>
          <Field label="Cancha">
            <select className={inputClass} value={form.court} onChange={(event) => setForm({ ...form, court: event.target.value })}>
              <option value="">Sin cancha específica</option>
              {availableCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TrialVisitStatus })}>
              {Object.entries(visitStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notas de la visita">
          <textarea className={`${inputClass} min-h-24 resize-y`} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</p> : null}
        <ModalActions saving={saving} onClose={onClose} />
      </form>
    </Modal>,
    document.body,
  );
}

function Modal({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[1300] flex items-start justify-center overflow-y-auto bg-zinc-950/55 px-3 py-6">
      <div className="motion-card w-full max-w-2xl overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{eyebrow}</p>
            <h3 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
          </div>
          <button aria-label="Cerrar" className={secondaryButtonClass} onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
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

function ModalActions({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:flex-row sm:justify-end">
      <button className={secondaryButtonClass} disabled={saving} onClick={onClose} type="button">Cancelar</button>
      <button className={primaryButtonClass} disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar cambios"}</button>
    </div>
  );
}

function BookingStatus({ status }: { status: TrialBookingStatus }) {
  const styles: Record<TrialBookingStatus, string> = {
    scheduled: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    in_progress: "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    completed: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    canceled: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>{bookingStatusLabels[status]}</span>;
}

function VisitStatus({ status }: { status: TrialVisitStatus }) {
  const styles: Record<TrialVisitStatus, string> = {
    scheduled: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    completed: "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    no_show: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    canceled: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${styles[status]}`}>{visitStatusLabels[status]}</span>;
}

function MiniMetric({ label, value, tone }: { label: string; value: number; tone: "emerald" | "blue" | "amber" }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-50",
    blue: "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/25 dark:text-blue-50",
    amber: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-50",
  };
  return (
    <article className={`rounded-md border p-4 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </article>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <CalendarClock className="mx-auto text-zinc-400" size={28} />
      <p className="mt-3 font-semibold text-zinc-800 dark:text-zinc-100">{title}</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{text}</p>
    </div>
  );
}

function nextScheduledVisit(booking: TrialBooking) {
  const now = Date.now();
  return [...booking.visits]
    .filter((visit) => visit.status === "scheduled" && new Date(visit.starts_at).getTime() >= now)
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())[0];
}
