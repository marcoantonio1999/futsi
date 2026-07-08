import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import type { AppData, AttendanceSession, Match } from "../../types";

type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  durationMinutes: number;
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

function eventStartMinute(value: string | null | undefined) {
  if (!value) return 9 * 60;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 9 * 60;
  return hours * 60 + minutes;
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function addDays(date: Date, delta: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

function startOfWeek(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function weekNumber(date: Date) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const pastDays = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
  return Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
}

function dayLongLabel(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

function eventEndMinute(event: CalendarEvent) {
  return Math.min(1439, eventStartMinute((event.raw as AttendanceSession | Match).starts_at) + Math.max(1, event.durationMinutes || 120));
}

function formatHour(hour: number) {
  return `${String(hour % 24).padStart(2, "0")}:00`;
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

const weekHourHeight = 36;
const mobileHourHeight = 76;

function buildEvents(data: AppData): CalendarEvent[] {
  const matchIds = new Set(data.matches.map((match) => match.id));

  const matchEvents: CalendarEvent[] = data.matches
    .filter((match) => match.status !== "canceled")
    .map((match) => ({
      id: `match-${match.id}`,
      date: match.played_on,
      time: eventTime(match.starts_at),
      durationMinutes: match.duration_minutes || 120,
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
      durationMinutes: session.duration_minutes || 120,
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

export function CalendarPanel({ data, scope = "academy" }: { data: AppData; scope?: "academy" | "adult" }) {
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

  const monthDays = buildCalendarDays(visibleMonth);
  const currentMonthKey = monthKey(visibleMonth);
  const titleColorClass = scope === "adult" ? "text-blue-700 dark:text-blue-300" : "text-emerald-700 dark:text-emerald-300";
  const selectedWeekStart = startOfWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(selectedWeekStart, index));
  const weekTitle = `Semana ${weekNumber(selectedWeekStart)}, ${monthLabel(selectedWeekStart)}`;
  const hourRows = Array.from({ length: 18 }, (_, index) => index + 7);
  const mobileHourRows = Array.from({ length: 18 }, (_, index) => index + 7);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const selectedDayLabel = dayLongLabel(selectedDate);
  const isSelectedToday = selectedDate === todayKey();
  const currentMinute = new Date().getHours() * 60 + new Date().getMinutes();
  const currentTop = Math.max(0, ((currentMinute - 7 * 60) / 60) * mobileHourHeight);
  const mobileTimelineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timeline = mobileTimelineRef.current;
    if (!timeline) return;
    const nextTop = isSelectedToday ? Math.max(0, currentTop - 260) : 0;
    timeline.scrollTo({ top: nextTop });
  }, [currentTop, isSelectedToday, selectedDate]);

  return (
    <div className="grid min-w-0 gap-5">
      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Agenda operativa</p>
            <h2 className={`mt-1 flex items-center gap-2 text-lg font-semibold ${titleColorClass}`}>
              <CalendarDays size={18} /> Calendario
            </h2>
          </div>
          <div className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            <button className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => {
              const now = new Date();
              setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedDate(todayKey());
            }} type="button">
              Hoy
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => setSelectedDate(dateKey(addDays(selectedWeekStart, -7)))} type="button" aria-label="Semana anterior">
              <ChevronLeft size={17} />
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => setSelectedDate(dateKey(addDays(selectedWeekStart, 7)))} type="button" aria-label="Semana siguiente">
              <ChevronRight size={17} />
            </button>
            <h3 className="min-w-0 self-center truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50 sm:min-w-[220px] sm:text-base">{weekTitle}</h3>
            <select className="col-span-4 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 sm:col-span-1" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
              <option value="all">Todas las sedes</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
            <select className="col-span-4 h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 sm:col-span-1" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
              <option value="all">Todos</option>
              <option value="training">Entrenamientos</option>
              <option value="match">Partidos</option>
              <option value="session_match">Sesiones de partido</option>
            </select>
          </div>
        </div>

        <div className="lg:hidden">
          <div className="border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day) => {
                const key = dateKey(day);
                const selected = key === selectedDate;
                const dayEvents = eventsByDate.get(key) ?? [];
                return (
                  <button
                    key={key}
                    className={`relative grid min-h-[62px] place-items-center rounded-md px-1 py-1 text-center transition ${selected ? "bg-blue-700 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}
                    onClick={() => setSelectedDate(key)}
                    type="button"
                  >
                    <span className="text-[11px] font-semibold uppercase">{day.toLocaleDateString("es-MX", { weekday: "narrow" })}</span>
                    <span className="text-xl font-semibold leading-none">{day.getDate()}</span>
                    {dayEvents.length ? <span className={`absolute bottom-1 size-1.5 rounded-full ${selected ? "bg-white" : "bg-emerald-600"}`} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="border-b border-zinc-200 px-4 py-3 text-center dark:border-zinc-800">
            <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{selectedDayLabel}</h3>
            <p className="mt-1 text-xs text-zinc-500">{selectedEvents.length} evento(s)</p>
          </div>
          <div ref={mobileTimelineRef} className="max-h-[calc(100svh-260px)] min-h-[520px] overflow-y-auto">
            <div className="relative grid grid-cols-[54px_minmax(0,1fr)]">
              <div className="border-r border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                {mobileHourRows.map((hour) => (
                  <div key={hour} className="border-b border-zinc-100 pr-2 pt-2 text-right text-xs text-zinc-500 dark:border-zinc-800" style={{ height: mobileHourHeight }}>
                    {formatHour(hour)}
                  </div>
                ))}
              </div>
              <div className="relative bg-white dark:bg-zinc-950">
                {mobileHourRows.map((hour) => <div key={hour} className="border-b border-zinc-100 dark:border-zinc-800" style={{ height: mobileHourHeight }} />)}
                {isSelectedToday && currentMinute >= 7 * 60 && currentMinute <= 24 * 60 ? (
                  <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: currentTop }}>
                    <span className="absolute -left-[50px] -top-3 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">{String(Math.floor(currentMinute / 60)).padStart(2, "0")}:{String(currentMinute % 60).padStart(2, "0")}</span>
                    <div className="h-0.5 bg-red-600" />
                  </div>
                ) : null}
                {selectedEvents.map((event, index) => {
                  const start = Math.max(7 * 60, eventStartMinute((event.raw as AttendanceSession | Match).starts_at));
                  const end = Math.max(start + 20, eventEndMinute(event));
                  const top = ((start - 7 * 60) / 60) * mobileHourHeight;
                  const height = Math.max(44, ((end - start) / 60) * mobileHourHeight);
                  return (
                    <article key={event.id} className={`absolute left-3 right-3 overflow-hidden rounded-md border px-3 py-2 text-xs shadow-sm ${eventTone(event.type)}`} style={{ top: top + index * 5, height }}>
                      <p className="font-semibold">{event.time}</p>
                      <p className="mt-0.5 line-clamp-2 font-semibold">{event.title}</p>
                      <p className="mt-1 line-clamp-1 opacity-80"><MapPin size={11} className="mr-1 inline" />{event.siteName}</p>
                    </article>
                  );
                })}
                {!selectedEvents.length ? <p className="px-4 py-8 text-sm text-zinc-500">No hay eventos para este dia con los filtros actuales.</p> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="hidden lg:grid lg:h-[calc(100svh-156px)] lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="border-b border-zinc-200 p-3 dark:border-zinc-800 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2">
              <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => setVisibleMonth((month) => addMonths(month, -1))} type="button" aria-label="Mes anterior">
                <ChevronLeft size={17} />
              </button>
              <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => setVisibleMonth((month) => addMonths(month, 1))} type="button" aria-label="Mes siguiente">
                <ChevronRight size={17} />
              </button>
              <h3 className="min-w-[190px] text-lg font-semibold capitalize text-zinc-950 dark:text-zinc-50">{monthLabel(visibleMonth)}</h3>
            </div>
            <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
              {["D", "L", "M", "M", "J", "V", "S"].map((day, index) => <div key={`${day}-${index}`} className="py-1.5">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
            {monthDays.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDate.get(key) ?? [];
              const inMonth = monthKey(day) === currentMonthKey;
              const selected = key === selectedDate;
              const inSelectedWeek = weekDays.some((weekDay) => dateKey(weekDay) === key);
              return (
                <button
                  key={key}
                  className={`relative grid aspect-square place-items-center rounded-md text-sm font-semibold transition ${selected ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100" : inSelectedWeek ? "bg-blue-50 text-zinc-800 dark:bg-blue-950/30 dark:text-zinc-100" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"} ${inMonth ? "" : "opacity-40"}`}
                  onClick={() => setSelectedDate(key)}
                  type="button"
                >
                  {day.getDate()}
                  {dayEvents.length ? <span className="absolute bottom-1 size-1 rounded-full bg-emerald-600" /> : null}
                </button>
              );
            })}
            </div>
          </aside>

          <div className="min-w-0 overflow-x-auto overflow-y-hidden">
            <div className="grid min-w-[920px] grid-cols-[72px_repeat(7,minmax(120px,1fr))] border-b border-zinc-200 dark:border-zinc-800">
              <div />
              {weekDays.map((day) => {
                const key = dateKey(day);
                const selected = key === selectedDate;
                return (
                  <button key={key} className={`border-l border-zinc-100 px-3 py-2.5 text-center transition dark:border-zinc-800 ${selected ? "bg-blue-50 dark:bg-blue-950/30" : ""}`} onClick={() => setSelectedDate(key)} type="button">
                    <p className={`text-sm font-semibold ${day.getDay() === 0 || day.getDay() === 6 ? "text-red-500" : "text-zinc-600 dark:text-zinc-300"}`}>{day.toLocaleDateString("es-MX", { weekday: "short" })}</p>
                    <p className={`mt-1 text-2xl font-semibold ${selected ? "text-blue-700 dark:text-blue-200" : "text-zinc-950 dark:text-zinc-50"}`}>{day.getDate()}</p>
                  </button>
                );
              })}
            </div>
            <div className="relative grid min-w-[920px] grid-cols-[72px_repeat(7,minmax(120px,1fr))]">
              <div className="border-r border-zinc-100 dark:border-zinc-800">
                {hourRows.map((hour) => (
                  <div key={hour} className="h-9 border-b border-zinc-100 pr-2 pt-1 text-right text-xs text-zinc-500 dark:border-zinc-800">
                    {formatHour(hour)}
                  </div>
                ))}
              </div>
              {weekDays.map((day) => {
                const key = dateKey(day);
                const dayEvents = eventsByDate.get(key) ?? [];
                return (
                  <div key={key} className="relative border-r border-zinc-100 dark:border-zinc-800">
                    {hourRows.map((hour) => <div key={hour} className="h-9 border-b border-zinc-100 dark:border-zinc-800" />)}
                    {dayEvents.map((event, index) => {
                      const top = Math.max(0, ((eventStartMinute((event.raw as AttendanceSession | Match).starts_at) - 7 * 60) / 60) * weekHourHeight);
                      const height = Math.max(34, (event.durationMinutes / 60) * weekHourHeight);
                      return (
                        <article key={event.id} className={`absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-xs shadow-sm ${eventTone(event.type)}`} style={{ top: top + index * 4, height }}>
                          <p className="font-semibold">{event.time}</p>
                          <p className="line-clamp-2 font-semibold">{event.title}</p>
                          <p className="mt-1 line-clamp-1 opacity-80"><MapPin size={11} className="mr-1 inline" />{event.siteName}</p>
                        </article>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
