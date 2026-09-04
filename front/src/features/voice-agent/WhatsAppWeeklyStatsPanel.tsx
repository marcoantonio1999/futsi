import { BarChart3, CheckCircle2, Clock3, MessageSquareWarning, UsersRound } from "lucide-react";
import type { WhatsAppResponseStatsSummary, WhatsAppWeeklyStats } from "../../types";
import { formatDateTime } from "./model";

const contactTypeLabels = {
  prospect: "Prospectos nuevos",
  current_client: "Clientes actuales",
  ambiguous: "Casos ambiguos",
  unclassified: "Sin clasificar",
};

function formatSeconds(value: number | null) {
  if (value === null) return "Sin datos";
  if (value < 60) return `${value} s`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.round((value % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return `${hours} h ${minutes} min`;
}

function formatWeekDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" }).format(date);
}

export function WhatsAppWeeklyStatsPanel({ value }: { value: WhatsAppWeeklyStats | null }) {
  if (!value) {
    return (
      <section className="rounded-md border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-950">
        <BarChart3 className="mx-auto text-zinc-400" size={32} />
        <p className="mt-3 font-semibold text-zinc-900 dark:text-zinc-100">Las estadísticas todavía no están disponibles</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Se empezarán a acumular con los próximos mensajes clasificados.</p>
      </section>
    );
  }

  const summary = value.summary;
  return (
    <div className="grid min-w-0 gap-4">
      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Semana actual</p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {formatWeekDate(value.week_start)} al {formatWeekDate(value.week_end)}
          </h3>
        </div>
        <p className="max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Los porcentajes usan como base todos los chats que requerían atención humana, incluidos los que siguen sin respuesta.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={UsersRound} label="Chats para el equipo" value={summary.total} />
        <MetricCard icon={CheckCircle2} label="Respondidos" value={summary.answered} />
        <MetricCard icon={MessageSquareWarning} label="Sin respuesta" value={summary.unanswered} />
        <MetricCard icon={Clock3} label="Promedio" value={formatSeconds(summary.average_response_seconds)} />
        <MetricCard icon={BarChart3} label="Mediana" value={formatSeconds(summary.median_response_seconds)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Cumplimiento de primera respuesta humana</h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Tiempo desde el primer mensaje pendiente hasta la primera respuesta de una persona.</p>
          <div className="mt-5 grid gap-4">
            <SlaBar label="En 5 minutos" value={summary.within_5_minutes_percent} />
            <SlaBar label="En 10 minutos" value={summary.within_10_minutes_percent} />
            <SlaBar label="En 30 minutos" value={summary.within_30_minutes_percent} />
            <SlaBar label="En 60 minutos" value={summary.within_60_minutes_percent} />
          </div>
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Mensajes clasificados</h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Clasificación previa a cualquier respuesta automática.</p>
          <div className="mt-4 grid gap-2">
            <ClassificationRow label="Prospectos nuevos" tone="emerald" value={value.classifications.prospect} />
            <ClassificationRow label="Clientes actuales" tone="violet" value={value.classifications.current_client} />
            <ClassificationRow label="Casos ambiguos" tone="amber" value={value.classifications.ambiguous} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PeriodCard label="Dentro del horario laboral" value={value.business_hours} />
        <PeriodCard label="Fuera del horario laboral" value={value.outside_business_hours} />
      </div>

      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Atención por persona o canal</h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">WhatsApp Business no siempre informa qué integrante del equipo respondió; en esos casos se agrupa por canal.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr><th className="px-5 py-3">Persona o canal</th><th className="px-5 py-3">Chats</th><th className="px-5 py-3">Promedio</th><th className="px-5 py-3">Mediana</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {value.by_responder.map((row) => (
                <tr key={row.key}><td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{row.name}</td><td className="px-5 py-3">{row.answered}</td><td className="px-5 py-3">{formatSeconds(row.average_response_seconds)}</td><td className="px-5 py-3">{formatSeconds(row.median_response_seconds)}</td></tr>
              ))}
              {!value.by_responder.length ? <tr><td className="px-5 py-6 text-center text-zinc-500" colSpan={4}>Aún no hay respuestas humanas registradas esta semana.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">10 esperas más largas</h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Incluye chats todavía pendientes para hacer visibles los retrasos actuales.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr><th className="px-5 py-3">Contacto</th><th className="px-5 py-3">Tipo</th><th className="px-5 py-3">Entró</th><th className="px-5 py-3">Espera</th><th className="px-5 py-3">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {value.longest_waits.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3"><p className="font-medium text-zinc-900 dark:text-zinc-100">{row.contact_name}</p><p className="text-xs text-zinc-500">{row.contact_phone}</p></td>
                  <td className="px-5 py-3">{contactTypeLabels[row.contact_type]}</td>
                  <td className="px-5 py-3">{formatDateTime(row.first_inbound_at)}</td>
                  <td className="px-5 py-3 font-semibold">{formatSeconds(row.response_seconds)}</td>
                  <td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.responded_at ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{row.responded_at ? "Respondido" : "Pendiente"}</span></td>
                </tr>
              ))}
              {!value.longest_waits.length ? <tr><td className="px-5 py-6 text-center text-zinc-500" colSpan={5}>No hay chats que requieran atención humana esta semana.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string | number }) {
  return <article className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><span className="grid size-9 place-items-center rounded-md bg-emerald-700 text-white"><Icon size={18} /></span><p className="mt-3 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p><p className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p></article>;
}

function SlaBar({ label, value }: { label: string; value: number }) {
  return <div><div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium text-zinc-700 dark:text-zinc-200">{label}</span><span className="font-semibold text-zinc-950 dark:text-zinc-50">{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></div>;
}

function ClassificationRow({ label, tone, value }: { label: string; tone: "emerald" | "violet" | "amber"; value: number }) {
  const classes = { emerald: "bg-emerald-100 text-emerald-800", violet: "bg-violet-100 text-violet-800", amber: "bg-amber-100 text-amber-800" }[tone];
  return <div className="flex items-center justify-between rounded-md border border-zinc-200 p-3 dark:border-zinc-800"><span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</span><span className={`rounded-full px-2 py-1 text-xs font-bold ${classes}`}>{value}</span></div>;
}

function PeriodCard({ label, value }: { label: string; value: WhatsAppResponseStatsSummary }) {
  return <article className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{label}</h3><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><SmallStat label="Chats" value={value.total} /><SmallStat label="Respondidos" value={value.answered} /><SmallStat label="Pendientes" value={value.unanswered} /><SmallStat label="Promedio" value={formatSeconds(value.average_response_seconds)} /></div></article>;
}

function SmallStat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900"><p className="font-semibold text-zinc-950 dark:text-zinc-50">{value}</p><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{label}</p></div>;
}
