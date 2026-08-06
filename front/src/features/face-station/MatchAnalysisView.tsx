import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, RefreshCw, ShieldCheck, Trophy, UserRound, UsersRound, X } from "lucide-react";
import { stationApi, toQuery } from "./api";
import { EmptyState, LoadingState, panelClass } from "./components";
import { compactNumber, dateLabel, identityTypeLabel } from "./format";
import type { MatchAnalysisDay, MatchAnalysisResponse, MatchAnalysisStatus, MatchAnalysisSummary, MatchParticipant, MatchWindow, ToastMessage } from "./types";

const MATCH_PAGE_SIZE = 100;
const WEEK_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const emptySummary: MatchAnalysisSummary = {
  total_days: 0,
  detected_days: 0,
  clear_days: 0,
  processing_days: 0,
  total_windows: 0,
  scheduled_matches: 0,
  scheduled_confirmed: 0,
  scheduled_unconfirmed: 0,
  unscheduled_matches: 0,
  first_date: "",
  last_date: "",
};

const emptyAnalysis: MatchAnalysisStatus = {
  running: false,
  force: false,
  processed_days: 0,
  total_days: 0,
  window_minutes: 50,
  minimum_unique_people: 10,
  schedule_tolerance_minutes: 15,
};

export function MatchAnalysisView({
  onNotify,
}: {
  onNotify: (text: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [days, setDays] = useState<MatchAnalysisDay[]>([]);
  const [summary, setSummary] = useState<MatchAnalysisSummary>(emptySummary);
  const [analysis, setAnalysis] = useState<MatchAnalysisStatus>(emptyAnalysis);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentMonth, setCurrentMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const requestId = useRef(0);

  const loadCalendar = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      let offset = 0;
      let total = 0;
      let firstPayload: MatchAnalysisResponse | null = null;
      const collected: MatchAnalysisDay[] = [];
      do {
        const payload = await stationApi<MatchAnalysisResponse>(`/api/match-analysis?${toQuery({
          status: "all",
          offset,
          limit: MATCH_PAGE_SIZE,
        })}`);
        if (id !== requestId.current) return;
        if (!firstPayload) firstPayload = payload;
        const pageItems = payload.items || [];
        collected.push(...pageItems);
        total = Number(payload.total || 0);
        offset += pageItems.length;
        if (!pageItems.length) break;
      } while (offset < total);
      if (id !== requestId.current) return;
      collected.sort((left, right) => left.analysis_date.localeCompare(right.analysis_date));
      setDays(collected);
      setSummary(firstPayload?.summary || emptySummary);
      setAnalysis(firstPayload?.analysis || emptyAnalysis);
    } catch (reason) {
      if (id === requestId.current) {
        setError(reason instanceof Error ? reason.message : "No se pudo cargar el análisis de partidos.");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    if (!analysis.running) return;
    const timer = window.setTimeout(() => void loadCalendar(), 2000);
    return () => window.clearTimeout(timer);
  }, [analysis.running, analysis.processed_days, loadCalendar]);

  useEffect(() => {
    if (currentMonth || !days.length) return;
    setCurrentMonth((summary.last_date || days[days.length - 1].analysis_date).slice(0, 7));
  }, [currentMonth, days, summary.last_date]);

  async function rerunHistory() {
    try {
      const result = await stationApi<{ started: boolean } & MatchAnalysisStatus>("/api/match-analysis/run?force=true", {
        method: "POST",
      });
      setAnalysis(result);
      onNotify(result.started ? "Reanálisis histórico iniciado." : "El análisis histórico ya está en ejecución.");
      window.setTimeout(() => void loadCalendar(), 500);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "No se pudo iniciar el análisis.", "error");
    }
  }

  const analysisProgress = analysis.total_days
    ? `${compactNumber(analysis.processed_days)} de ${compactNumber(analysis.total_days)} días`
    : "Preparando historial";
  const daysByDate = useMemo(() => new Map(days.map((day) => [day.analysis_date, day])), [days]);
  const selectedDay = selectedDate ? daysByDate.get(selectedDate) : undefined;
  const firstMonth = (summary.first_date || days[0]?.analysis_date || currentMonth).slice(0, 7);
  const lastMonth = (summary.last_date || days[days.length - 1]?.analysis_date || currentMonth).slice(0, 7);

  function changeMonth(delta: number) {
    if (!currentMonth) return;
    const next = localDate(`${currentMonth}-01`);
    next.setMonth(next.getMonth() + delta);
    setCurrentMonth(isoLocalDate(next).slice(0, 7));
  }

  function openDate(date: string) {
    setCurrentMonth(date.slice(0, 7));
    setSelectedDate(date);
  }

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-amber-700">Control de uso de cancha</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">Calendario mensual de partidos</h1>
          <p className="mt-1 text-xs text-zinc-500">Consulta el mes completo y abre cualquier día para navegar sus horarios en una sola línea de tiempo. Las alertas aparecen cuando {analysis.minimum_unique_people} identidades coinciden durante {analysis.window_minutes} minutos fuera del calendario autorizado.</p>
        </div>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-[10px] font-bold text-zinc-700 shadow-sm transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:cursor-wait disabled:opacity-60"
          type="button"
          disabled={analysis.running}
          onClick={() => void rerunHistory()}
        >
          <RefreshCw size={14} className={analysis.running ? "animate-spin" : ""} />
          {analysis.running ? analysisProgress : "Recalcular historial"}
        </button>
      </header>

      <section className="mb-4 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-950 via-amber-900 to-orange-800 p-4 text-white shadow-sm" aria-label="Regla de detección">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-amber-200"><Trophy size={20} /></span>
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-amber-200">Regla activa</p>
              <strong className="mt-1 block text-lg">Calendario semanal · llegadas ±{analysis.schedule_tolerance_minutes || 15} min · alertas de {analysis.minimum_unique_people} personas</strong>
              <p className="mt-1 text-[10px] text-amber-100/70">Las apariciones cercanas a dos horarios se resuelven por presencia dominante: una llegada anticipada acompaña al partido donde esa persona aparece más veces. Los colaboradores nunca cuentan.</p>
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-right">
            <span className="block text-[8px] font-extrabold uppercase tracking-wider text-amber-100/60">Historial disponible</span>
            <strong className="text-sm">{summary.first_date ? `${dateLabel(summary.first_date)} — ${dateLabel(summary.last_date)}` : "Pendiente de análisis"}</strong>
          </div>
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex flex-col gap-3 border-b border-zinc-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Vista del mes</h2>
            <p className="mt-0.5 text-[9px] text-zinc-500">Selecciona un día para abrir su línea de tiempo sin desplegar listas extensas.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[8px] font-bold text-zinc-500" aria-label="Leyenda del calendario">
            <CalendarLegend tone="bg-blue-500" label="Programado" />
            <CalendarLegend tone="bg-emerald-500" label="Con evidencia" />
            <CalendarLegend tone="bg-red-500" label="Fuera de horario" />
            <CalendarLegend tone="bg-zinc-300" label="Sin datos" />
          </div>
        </div>

        {analysis.running ? (
          <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2.5 text-[10px] font-semibold text-blue-800">
            <RefreshCw size={13} className="animate-spin" /> Analizando {analysisProgress}{analysis.current_date ? ` · ${dateLabel(analysis.current_date)}` : ""}. La detección de rostros continúa activa.
          </div>
        ) : analysis.last_error ? (
          <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5 text-[10px] font-semibold text-red-800">
            <AlertTriangle size={13} /> {analysis.last_error}
          </div>
        ) : null}

        {error && days.length ? (
          <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5 text-[10px] font-semibold text-red-800">
            <AlertTriangle size={13} /> {error}
          </div>
        ) : null}

        <div className="bg-zinc-50/70 p-3 sm:p-4">
          {loading && !days.length ? (
            <LoadingState label="Consultando historial de partidos..." />
          ) : error && !days.length ? (
            <EmptyState error title="No se pudo abrir el historial" detail={error} />
          ) : !days.length ? (
            <EmptyState title="Todavía no hay resultados" detail={analysis.running ? "El primer análisis histórico está en curso." : "Ejecuta el análisis para revisar los recortes procesados."} />
          ) : currentMonth ? (
            <MatchMonthCalendar
              month={currentMonth}
              daysByDate={daysByDate}
              firstMonth={firstMonth}
              lastMonth={lastMonth}
              onPrevious={() => changeMonth(-1)}
              onNext={() => changeMonth(1)}
              onLatest={() => setCurrentMonth(lastMonth)}
              onOpenDate={openDate}
            />
          ) : null}
        </div>
      </section>

      {selectedDate ? (
        <MatchDayTimelineDialog
          date={selectedDate}
          day={selectedDay}
          onClose={() => setSelectedDate("")}
          onSelectDate={openDate}
        />
      ) : null}
    </div>
  );
}

function localDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function isoLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function CalendarLegend({ tone, label }: { tone: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${tone}`} />{label}</span>;
}

function monthTitle(month: string) {
  const title = localDate(`${month}-01`).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function monthCells(month: string) {
  const first = localDate(`${month}-01`);
  const offset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(date.getDate() + index);
    return isoLocalDate(date);
  });
}

function MatchMonthCalendar({
  month,
  daysByDate,
  firstMonth,
  lastMonth,
  onPrevious,
  onNext,
  onLatest,
  onOpenDate,
}: {
  month: string;
  daysByDate: Map<string, MatchAnalysisDay>;
  firstMonth: string;
  lastMonth: string;
  onPrevious: () => void;
  onNext: () => void;
  onLatest: () => void;
  onOpenDate: (date: string) => void;
}) {
  const cells = monthCells(month);
  const monthDays = Array.from(daysByDate.values()).filter((day) => day.analysis_date.startsWith(month));
  const scheduled = monthDays.reduce((sum, day) => sum + Number(day.scheduled_count || 0), 0);
  const confirmed = monthDays.reduce((sum, day) => sum + Number(day.scheduled_confirmed_count || 0), 0);
  const outside = monthDays.reduce((sum, day) => sum + Number(day.unscheduled_count || 0), 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Mes anterior" disabled={month <= firstMonth} onClick={onPrevious} className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft size={16} /></button>
          <div className="min-w-44 text-center">
            <p className="text-[8px] font-extrabold uppercase tracking-widest text-amber-700">Mes seleccionado</p>
            <h3 className="text-lg font-extrabold text-zinc-900">{monthTitle(month)}</h3>
          </div>
          <button type="button" aria-label="Mes siguiente" disabled={month >= lastMonth} onClick={onNext} className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight size={16} /></button>
          {month !== lastMonth ? <button type="button" onClick={onLatest} className="ml-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[8px] font-extrabold text-amber-800">Último mes</button> : null}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-5">
          <MonthStat label="Programados" value={scheduled} tone="text-blue-700" />
          <MonthStat label="Con evidencia" value={confirmed} tone="text-emerald-700" />
          <MonthStat label="Alertas" value={outside} tone={outside ? "text-red-700" : "text-zinc-400"} />
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-100/80">
        {WEEK_DAYS.map((label) => <div key={label} className="px-1 py-2 text-center text-[8px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px bg-zinc-200">
        {cells.map((date) => (
          <CalendarDay
            key={date}
            date={date}
            day={daysByDate.get(date)}
            inMonth={date.startsWith(month)}
            onOpen={() => onOpenDate(date)}
          />
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-[8px] font-semibold text-zinc-500">
        <CalendarDays size={12} className="text-amber-700" /> Haz clic en cualquier día del mes para abrir su detalle por horas.
      </div>
    </div>
  );
}

function MonthStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <span className="text-center sm:text-right"><span className="block text-[7px] font-bold uppercase tracking-wide text-zinc-400">{label}</span><strong className={`text-base tabular-nums ${tone}`}>{compactNumber(value)}</strong></span>;
}

function CalendarDay({ date, day, inMonth, onOpen }: { date: string; day?: MatchAnalysisDay; inMonth: boolean; onOpen: () => void }) {
  const processing = Boolean(day && day.status !== "complete");
  const outside = Number(day?.unscheduled_count || 0);
  const scheduled = Number(day?.scheduled_count || 0);
  const confirmed = Number(day?.scheduled_confirmed_count || 0);
  const surface = !inMonth
    ? "bg-zinc-50 text-zinc-300"
    : processing
      ? "bg-blue-50 hover:bg-blue-100"
      : outside
        ? "bg-red-50 hover:bg-red-100"
        : confirmed
          ? "bg-emerald-50/70 hover:bg-emerald-100"
          : scheduled
            ? "bg-amber-50 hover:bg-amber-100"
            : "bg-white hover:bg-zinc-50";

  return (
    <button
      type="button"
      disabled={!inMonth}
      onClick={onOpen}
      className={`relative min-h-20 overflow-hidden p-1.5 text-left transition sm:min-h-[90px] sm:p-2.5 ${surface} disabled:cursor-default`}
      aria-label={`Abrir ${dateLabel(date)}`}
    >
      <div className="flex items-center justify-between">
        <strong className={`text-xs tabular-nums ${inMonth ? "text-zinc-800" : "text-zinc-300"}`}>{localDate(date).getDate()}</strong>
        {inMonth ? <span className={`size-2 rounded-full ${processing ? "animate-pulse bg-blue-500" : outside ? "bg-red-500" : confirmed ? "bg-emerald-500" : scheduled ? "bg-amber-500" : "bg-zinc-300"}`} /> : null}
      </div>
      {inMonth && day ? (
        <div className="mt-1.5 space-y-1">
          {processing ? <span className="inline-flex items-center gap-1 text-[7px] font-extrabold text-blue-700"><RefreshCw size={9} className="animate-spin" /> Procesando</span> : null}
          {scheduled ? <p className="truncate text-[7px] font-bold text-blue-700 sm:text-[8px]">{scheduled} programados</p> : null}
          {confirmed ? <p className="truncate text-[7px] font-bold text-emerald-700 sm:text-[8px]">{confirmed} con evidencia</p> : null}
          {outside ? <p className="inline-flex max-w-full items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[7px] font-extrabold text-white sm:text-[8px]"><AlertTriangle size={8} /> {outside} fuera</p> : null}
          <p className="hidden truncate text-[7px] text-zinc-400 sm:block">{compactNumber(day.source_crop_count)} recortes</p>
        </div>
      ) : inMonth ? <p className="mt-3 text-[7px] font-semibold text-zinc-300 sm:text-[8px]">Sin datos</p> : null}
    </button>
  );
}

function shiftDate(date: string, days: number) {
  const shifted = localDate(date);
  shifted.setDate(shifted.getDate() + days);
  return isoLocalDate(shifted);
}

function minutesInDay(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getHours() * 60 + parsed.getMinutes() + parsed.getSeconds() / 60;
}

function minuteLabel(minutes: number) {
  const date = new Date(2026, 0, 1, Math.floor(minutes / 60), Math.round(minutes % 60));
  return date.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
}

function MatchDayTimelineDialog({
  date,
  day,
  onClose,
  onSelectDate,
}: {
  date: string;
  day?: MatchAnalysisDay;
  onClose: () => void;
  onSelectDate: (date: string) => void;
}) {
  const sortedWindows = useMemo(() => [...(day?.windows || [])].sort((left, right) => left.starts_at.localeCompare(right.starts_at)), [day]);
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);

  useEffect(() => {
    const preferred = sortedWindows.find((window) => window.window_type === "unscheduled") || sortedWindows.find((window) => window.participant_count > 0) || sortedWindows[0];
    setSelectedWindowId(preferred?.id ?? null);
  }, [date, sortedWindows]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onSelectDate(shiftDate(date, -1));
      if (event.key === "ArrowRight") onSelectDate(shiftDate(date, 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [date, onClose, onSelectDate]);

  const selectedWindow = sortedWindows.find((window) => window.id === selectedWindowId);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/55 p-2 backdrop-blur-[2px] sm:p-4" role="dialog" aria-modal="true" aria-label={`Detalle de ${dateLabel(date)}`}>
      <div className="flex max-h-[95vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-label="Día anterior" onClick={() => onSelectDate(shiftDate(date, -1))} className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-amber-50"><ChevronLeft size={16} /></button>
            <div className="min-w-0">
              <p className="text-[8px] font-extrabold uppercase tracking-widest text-amber-700">Detalle del día</p>
              <h2 className="truncate text-lg font-extrabold text-zinc-900 sm:text-xl">{dateLabel(date)}</h2>
            </div>
            <button type="button" aria-label="Día siguiente" onClick={() => onSelectDate(shiftDate(date, 1))} className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-amber-50"><ChevronRight size={16} /></button>
          </div>
          <div className="hidden items-center gap-5 sm:flex">
            <MonthStat label="Programados" value={Number(day?.scheduled_count || 0)} tone="text-blue-700" />
            <MonthStat label="Con evidencia" value={Number(day?.scheduled_confirmed_count || 0)} tone="text-emerald-700" />
            <MonthStat label="Fuera de horario" value={Number(day?.unscheduled_count || 0)} tone={day?.unscheduled_count ? "text-red-700" : "text-zinc-400"} />
            <MonthStat label="Recortes" value={Number(day?.source_crop_count || 0)} tone="text-zinc-800" />
          </div>
          <button type="button" aria-label="Cerrar detalle" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"><X size={16} /></button>
        </header>

        <div className="station-scrollbar flex-1 overflow-y-auto p-3 sm:p-5">
          {!day ? (
            <EmptyState title="Sin análisis para este día" detail="No hay recortes ni horarios procesados en esta fecha. Usa las flechas para revisar el día anterior o siguiente." />
          ) : day.status !== "complete" ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[9px] font-semibold text-blue-800"><RefreshCw size={12} className="animate-spin" /> Quedan {compactNumber(day.unresolved_queue_count)} recortes por procesar; la línea de tiempo se completará al terminar la cola.</div>
          ) : null}

          {day && sortedWindows.length ? (
            <>
              <DayTimeline windows={sortedWindows} selectedWindowId={selectedWindowId} onSelectWindow={setSelectedWindowId} />
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <div><p className="text-[8px] font-extrabold uppercase tracking-widest text-zinc-400">Bloque seleccionado</p><p className="text-[9px] text-zinc-500">Toca otro horario en la línea para cambiar el detalle.</p></div>
                  <span className="hidden text-[8px] font-semibold text-zinc-400 sm:inline">← → cambia de día · Esc cierra</span>
                </div>
                {selectedWindow ? <MatchWindowCard key={selectedWindow.id} window={selectedWindow} defaultExpanded={false} /> : null}
              </div>
            </>
          ) : day ? (
            <EmptyState title="Sin bloques detectados" detail="Este día no contiene partidos programados ni alertas fuera de horario." />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DayTimeline({ windows, selectedWindowId, onSelectWindow }: { windows: MatchWindow[]; selectedWindowId: number | null; onSelectWindow: (id: number) => void }) {
  const starts = windows.map((window) => minutesInDay(window.starts_at));
  const ends = windows.map((window) => minutesInDay(window.ends_at));
  const startMinute = Math.max(0, Math.floor((Math.min(...starts) - 15) / 60) * 60);
  const endMinute = Math.min(1440, Math.max(startMinute + 180, Math.ceil((Math.max(...ends) + 15) / 60) * 60));
  const duration = Math.max(60, endMinute - startMinute);
  const hourMarks = Array.from({ length: Math.floor(duration / 60) + 1 }, (_, index) => startMinute + index * 60).filter((minute) => minute <= endMinute);

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm" aria-label="Línea de tiempo del día">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5">
        <div><h3 className="text-xs font-extrabold text-zinc-900">Línea de tiempo</h3><p className="text-[8px] text-zinc-500">Todos los horarios del día en una sola vista.</p></div>
        <div className="flex gap-3 text-[8px] font-bold text-zinc-500"><CalendarLegend tone="bg-blue-500" label="Programado" /><CalendarLegend tone="bg-amber-500" label="Sin evidencia" /><CalendarLegend tone="bg-red-500" label="Fuera de horario" /></div>
      </div>
      <div className="station-scrollbar overflow-x-auto px-3 pb-3 pt-2">
        <div className="relative h-36 min-w-[920px]">
          {hourMarks.map((minute) => {
            const left = ((minute - startMinute) / duration) * 100;
            return <div key={minute} className="absolute bottom-0 top-0 border-l border-dashed border-zinc-200" style={{ left: `${left}%` }}><span className="absolute left-1 top-0 whitespace-nowrap text-[7px] font-semibold text-zinc-400">{minuteLabel(minute)}</span></div>;
          })}
          <span className="absolute left-0 top-7 text-[7px] font-extrabold uppercase text-zinc-400">Programados</span>
          <span className="absolute left-0 top-[86px] text-[7px] font-extrabold uppercase text-red-500">Alertas</span>
          {windows.map((window) => {
            const start = minutesInDay(window.starts_at);
            const end = minutesInDay(window.ends_at);
            const left = ((start - startMinute) / duration) * 100;
            const width = Math.max(1.5, ((end - start) / duration) * 100);
            const scheduled = window.window_type === "scheduled";
            const selected = window.id === selectedWindowId;
            const tone = scheduled
              ? window.window_status === "scheduled_with_evidence"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-amber-500 bg-amber-100 text-amber-900"
              : "border-red-600 bg-red-600 text-white";
            return (
              <button
                key={window.id}
                type="button"
                onClick={() => onSelectWindow(window.id)}
                className={`absolute z-10 h-10 overflow-hidden rounded-lg border px-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tone} ${selected ? "ring-2 ring-zinc-900 ring-offset-2" : ""}`}
                style={{ left: `${left}%`, width: `${width}%`, top: scheduled ? 40 : 96 }}
                title={`${timeLabel(window.starts_at)} — ${timeLabel(window.ends_at)} · ${window.participant_count} participantes`}
                aria-pressed={selected}
              >
                <strong className="block truncate text-[8px]">{timeLabel(window.starts_at)}</strong>
                <span className="block truncate text-[7px] opacity-80">{window.participant_count} personas</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function MatchWindowCard({
  window,
  defaultExpanded,
}: {
  window: MatchWindow;
  defaultExpanded: boolean;
}) {
  const scheduled = window.window_type === "scheduled";
  const confirmed = window.window_status === "scheduled_with_evidence";
  const hasEvidence = Number(window.participant_count || 0) > 0;
  const [expanded, setExpanded] = useState(defaultExpanded && hasEvidence);
  const [participants, setParticipants] = useState<MatchParticipant[]>(window.participants || []);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [participantError, setParticipantError] = useState("");

  const loadParticipants = useCallback(async () => {
    if (participants.length || loadingParticipants || participantError) return;
    setLoadingParticipants(true);
    setParticipantError("");
    try {
      const payload = await stationApi<{ items: MatchParticipant[] }>(
        `/api/match-analysis/windows/${window.id}/participants`,
      );
      setParticipants(payload.items || []);
    } catch (reason) {
      setParticipantError(reason instanceof Error ? reason.message : "No se pudo cargar la evidencia.");
    } finally {
      setLoadingParticipants(false);
    }
  }, [loadingParticipants, participantError, participants.length, window.id]);

  useEffect(() => {
    if (expanded) void loadParticipants();
  }, [expanded, loadParticipants]);

  function toggleEvidence() {
    setExpanded((current) => !current);
  }

  const cardTone = scheduled
    ? confirmed
      ? "border-blue-200 bg-blue-50/50"
      : "border-amber-200 bg-amber-50/50"
    : "border-red-200 bg-red-50/50";
  const accent = scheduled
    ? confirmed
      ? "text-blue-700"
      : "text-amber-700"
    : "text-red-700";
  const label = scheduled
    ? confirmed
      ? "Partido programado · evidencia disponible"
      : window.window_status === "scheduled"
        ? "Próximo partido programado"
        : "Partido programado · sin evidencia"
    : "Alerta · partido fuera de horario";
  const teams = scheduled
    ? `${window.home_team || "Equipo por confirmar"} vs ${window.away_team || "Equipo por confirmar"}`
    : "10 o más personas fuera de un horario autorizado";

  return (
    <section className={`rounded-xl border p-3 ${cardTone}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={`text-[8px] font-extrabold uppercase tracking-wider ${accent}`}>{label}</p>
          <h4 className="mt-0.5 truncate text-xs font-bold text-zinc-900">{scheduled && window.tournament ? `${window.tournament} · ` : ""}{teams}</h4>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-semibold text-zinc-600">
            <Clock3 size={12} className={accent} /> {timeLabel(window.starts_at)} — {timeLabel(window.ends_at)}
            <span className="font-medium text-zinc-400">
              {scheduled
                ? `· horario base · tolerancia ±${compactNumber(window.tolerance_minutes || 0)} min`
                : `· ventana analítica de ${compactNumber(window.duration_minutes)} min`}
            </span>
          </p>
          {window.evidence_starts_at && window.evidence_ends_at ? (
            <p className="mt-1 text-[8px] text-zinc-500">Evidencia observada: {timeLabel(window.evidence_starts_at)} — {timeLabel(window.evidence_ends_at)}. Este rango no se interpreta como duración exacta del partido.</p>
          ) : scheduled ? (
            <p className="mt-1 text-[8px] text-zinc-500">Todavía no hay suficientes rostros dentro de este horario.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <WindowStat icon={<UsersRound size={11} />} label={`${compactNumber(window.participant_count)} participantes`} />
          <WindowStat icon={<ShieldCheck size={11} />} label={`${compactNumber(window.known_count)} reconocidos`} />
          <WindowStat icon={<UserRound size={11} />} label={`${compactNumber(window.unknown_count)} no reconocidos`} />
          {hasEvidence ? (
            <button
              className={`inline-flex min-h-7 items-center gap-1 rounded-md border bg-white px-2 text-[8px] font-bold transition ${scheduled ? "border-blue-200 text-blue-800 hover:bg-blue-100" : "border-red-200 text-red-800 hover:bg-red-100"}`}
              type="button"
              onClick={toggleEvidence}
              aria-expanded={expanded}
              disabled={loadingParticipants}
            >
              {loadingParticipants ? <RefreshCw size={11} className="animate-spin" /> : expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {loadingParticipants ? "Cargando..." : expanded ? "Ocultar rostros" : `Ver ${compactNumber(window.participant_count)} rostros`}
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        participantError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[9px] font-semibold text-red-700">{participantError}</div>
        ) : loadingParticipants && !participants.length ? (
          <div className="mt-3 flex min-h-20 items-center justify-center gap-2 text-[9px] font-semibold text-amber-800"><RefreshCw size={12} className="animate-spin" /> Cargando evidencia...</div>
        ) : (
          <div className="station-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Evidencia de participantes">
            {participants.map((participant) => (
              <MatchParticipantEvidence key={`${participant.kind}:${participant.key}`} participant={participant} />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

function WindowStat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-[8px] font-bold text-zinc-600">{icon}{label}</span>;
}

function MatchParticipantEvidence({ participant }: { participant: MatchParticipant }) {
  const fallback = `/api/images/${participant.kind === "known" ? "person" : "unknown"}/${encodeURIComponent(participant.key)}`;
  const [src, setSrc] = useState(`/api/match-analysis/evidence/${participant.best_crop_id}`);
  return (
    <div className="w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <img
        className="h-20 w-full bg-zinc-100 object-cover"
        src={src}
        alt={`Evidencia de ${participant.name}`}
        loading="lazy"
        decoding="async"
        onError={(event) => {
          if (src !== fallback) setSrc(fallback);
          else event.currentTarget.style.visibility = "hidden";
        }}
      />
      <div className="p-1.5">
        <strong className="block truncate text-[8px] text-zinc-800" title={participant.name}>{participant.name}</strong>
        <span className="mt-0.5 block truncate text-[7px] text-zinc-400">
          {participant.kind === "known" ? identityTypeLabel(participant.person_type) : "No reconocido"}
        </span>
        <span
          className="mt-1 flex items-center gap-1 text-[7px] font-semibold tabular-nums text-zinc-600"
          title={`Recorte capturado a las ${cropTimeLabel(participant.best_crop_seen_at || participant.first_seen_at)}`}
        >
          <Clock3 size={8} className="shrink-0 text-amber-700" />
          {cropTimeLabel(participant.best_crop_seen_at || participant.first_seen_at)}
        </span>
      </div>
    </div>
  );
}

function cropTimeLabel(value: string) {
  if (!value) return "Hora no disponible";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Hora no disponible";
  return parsed.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function timeLabel(value: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
