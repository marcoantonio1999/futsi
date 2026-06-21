import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Trophy, UsersRound } from "lucide-react";
import type { AppData, AttendanceSession, Match } from "../../types";

type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  type: "training" | "match" | "session_match";
  title: string;
  subtitle: string;
  siteId: number | null;
  siteName: string;
  source: "attendance_sessions" | "matches";
  raw: AttendanceSession | Match;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

function eventTime(value: string | null | undefined) {
  return value?.slice(0, 5) || "Sin hora";
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function buildCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function eventTone(type: CalendarEvent["type"]) {
  if (type === "match") return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200";
  if (type === "session_match") return "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200";
  return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200";
}

function eventTypeLabel(type: CalendarEvent["type"]) {
  if (type === "match") return "Partido";
  if (type === "session_match") return "Sesion de partido";
  return "Entrenamiento";
}

function buildEvents(data: AppData): CalendarEvent[] {
  const matchIds = new Set(data.matches.map((match) => match.id));

  const matchEvents: CalendarEvent[] = data.matches
    .filter((match) => match.status !== "canceled")
    .map((match) => ({
      id: `match-${match.id}`,
      date: match.played_on,
      time: eventTime(match.starts_at),
      type: "match",
      title: `${match.home_team_name || "Local"} vs ${match.away_team_name || "Visitante"}`,
      subtitle: match.tournament_name || "Torneo",
      siteId: match.site,
      siteName: match.site_name || "Sede",
      source: "matches",
      raw: match,
    }));

  const sessionEvents: CalendarEvent[] = data.attendanceSessions
    .filter((session) => session.session_type === "academy_class" || !session.match || !matchIds.has(session.match))
    .map((session) => ({
      id: `session-${session.id}`,
      date: session.date,
      time: eventTime(session.starts_at),
      type: session.session_type === "tournament_match" ? "session_match" : "training",
      title: session.match_name || session.team_name || session.group_name || (session.session_type === "tournament_match" ? "Partido" : "Entrenamiento"),
      subtitle: session.session_type === "tournament_match" ? session.tournament_name || "Torneo" : session.group_name || "Academia",
      siteId: session.site,
      siteName: session.site_name || "Sede",
      source: "attendance_sessions",
      raw: session,
    }));

  return [...matchEvents, ...sessionEvents].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function CalendarPanel({ data }: { data: AppData }) {
  const initialMonth = useMemo(() => {
    const firstEventDate = [...data.attendanceSessions.map((session) => session.date), ...data.matches.map((match) => match.played_on)].sort().find(Boolean);
    const base = firstEventDate || todayKey();
    const [year, month] = base.split("-").map(Number);
    return new Date(year, (month || 1) - 1, 1);
  }, [data.attendanceSessions, data.matches]);

  const [visibleMonth, setVisibleMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [siteFilter, setSiteFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | CalendarEvent["type"]>("all");

  const events = useMemo(() => buildEvents(data), [data]);
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (siteFilter !== "all" && String(event.siteId) !== siteFilter) return false;
      if (typeFilter !== "all" && event.type !== typeFilter) return false;
      return true;
    });
  }, [events, siteFilter, typeFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    filteredEvents.forEach((event) => {
      const items = map.get(event.date) ?? [];
      items.push(event);
      map.set(event.date, items);
    });
    return map;
  }, [filteredEvents]);

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const monthDays = buildCalendarDays(visibleMonth);
  const currentMonthKey = monthKey(visibleMonth);

  return (
    <div className="grid min-w-0 gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Agenda operativa</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              <CalendarDays size={20} /> Calendario
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Entrenamientos desde <span className="font-semibold">attendance_sessions</span>; partidos programados desde <span className="font-semibold">matches</span>.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">Sede</span>
              <select className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
                <option value="all">Todas</option>
                {data.sites.map((site) => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">Tipo</span>
              <select className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
                <option value="all">Todos</option>
                <option value="training">Entrenamientos</option>
                <option value="match">Partidos</option>
                <option value="session_match">Sesiones de partido</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 md:grid-cols-3">
          <p><span className="font-semibold">Supabase tabla:</span> public.attendance_sessions</p>
          <p><span className="font-semibold">Supabase tabla:</span> public.matches</p>
          <p><span className="font-semibold">Relacion:</span> matches genera sesiones tipo tournament_match cuando se pasa lista.</p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => setVisibleMonth((month) => addMonths(month, -1))} type="button" aria-label="Mes anterior">
                <ChevronLeft size={17} />
              </button>
              <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => setVisibleMonth((month) => addMonths(month, 1))} type="button" aria-label="Mes siguiente">
                <ChevronRight size={17} />
              </button>
              <h3 className="min-w-[190px] text-lg font-semibold capitalize text-zinc-950 dark:text-zinc-50">{monthLabel(visibleMonth)}</h3>
            </div>
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => {
              const now = new Date();
              setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedDate(todayKey());
            }} type="button">
              Hoy
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-xs font-semibold uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"].map((day) => (
              <div key={day} className="px-2 py-2">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDate.get(key) ?? [];
              const inMonth = monthKey(day) === currentMonthKey;
              const selected = key === selectedDate;
              const isToday = key === todayKey();
              return (
                <button
                  key={key}
                  className={`min-h-28 border-b border-r border-zinc-100 p-2 text-left transition dark:border-zinc-800 ${selected ? "bg-emerald-50 ring-2 ring-inset ring-emerald-700 dark:bg-emerald-950/40" : "bg-white hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"} ${inMonth ? "" : "opacity-45"}`}
                  onClick={() => setSelectedDate(key)}
                  type="button"
                >
                  <span className={`inline-grid size-7 place-items-center rounded-full text-sm font-semibold ${isToday ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950" : "text-zinc-700 dark:text-zinc-200"}`}>{day.getDate()}</span>
                  <div className="mt-2 grid gap-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span key={event.id} className={`truncate rounded-md border px-2 py-1 text-[11px] font-semibold ${eventTone(event.type)}`}>
                        {event.time} {event.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 && <span className="text-xs font-medium text-zinc-500">+{dayEvents.length - 3} mas</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Detalle del dia</p>
            <h3 className="mt-1 font-semibold text-zinc-950 dark:text-zinc-50">{selectedDate}</h3>
            <p className="mt-1 text-sm text-zinc-500">{selectedEvents.length} evento(s)</p>
          </div>
          <div className="max-h-[720px] divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
            {selectedEvents.map((event) => (
              <article key={event.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${eventTone(event.type)}`}>{eventTypeLabel(event.type)}</span>
                  <span className="text-xs font-medium text-zinc-500">{event.source}</span>
                </div>
                <h4 className="mt-3 font-semibold text-zinc-950 dark:text-zinc-50">{event.title}</h4>
                <p className="mt-1 text-sm text-zinc-500">{event.subtitle}</p>
                <div className="mt-3 grid gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                  <p className="flex items-center gap-2"><Clock3 size={15} /> {event.time}</p>
                  <p className="flex items-center gap-2"><MapPin size={15} /> {event.siteName}</p>
                  {event.type !== "training" && <p className="flex items-center gap-2"><Trophy size={15} /> Partido programado</p>}
                  {event.type === "training" && <p className="flex items-center gap-2"><UsersRound size={15} /> Entrenamiento / sesion academia</p>}
                </div>
              </article>
            ))}
            {selectedEvents.length === 0 && (
              <p className="px-4 py-8 text-sm text-zinc-500">No hay partidos ni entrenamientos para este dia con los filtros actuales.</p>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
