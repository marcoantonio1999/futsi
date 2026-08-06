import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Banknote, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, LayoutDashboard, RefreshCw, Save, ShieldCheck, Trophy, UserRound, UsersRound, X } from "lucide-react";
import { stationApi, toQuery } from "./api";
import { EmptyState, LoadingState, panelClass } from "./components";
import { compactNumber, currency, dateLabel, identityTypeLabel } from "./format";
import type { MatchAnalysisDay, MatchAnalysisResponse, MatchAnalysisStatus, MatchAnalysisSummary, MatchParticipant, MatchScheduleItem, MatchScheduleResponse, MatchWindow, ToastMessage } from "./types";

const MATCH_PAGE_SIZE = 100;
const WEEK_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
type MatchViewMode = "summary" | "calendar";

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
  const [viewMode, setViewMode] = useState<MatchViewMode>("summary");
  const [currentMonth, setCurrentMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);
  const [matchFee, setMatchFee] = useState(0);
  const [matchFeeDraft, setMatchFeeDraft] = useState("0");
  const [savingMatchFee, setSavingMatchFee] = useState(false);
  const [scheduleItems, setScheduleItems] = useState<MatchScheduleItem[]>([]);
  const [scheduleMonth, setScheduleMonth] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const requestId = useRef(0);
  const scheduleRequestId = useRef(0);
  const feeLoaded = useRef(false);
  const tabListRef = useRef<HTMLDivElement>(null);
  const pendingFullHistoryRefresh = useRef(false);

  const loadCalendar = useCallback(async (fullHistory = true) => {
    const id = ++requestId.current;
    if (fullHistory) setLoading(true);
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
      } while (fullHistory && offset < total);
      if (id !== requestId.current) return;
      collected.sort((left, right) => left.analysis_date.localeCompare(right.analysis_date));
      setDays((current) => {
        if (fullHistory) return collected;
        const merged = new Map(current.map((day) => [day.analysis_date, day]));
        for (const day of collected) merged.set(day.analysis_date, day);
        return Array.from(merged.values()).sort((left, right) => left.analysis_date.localeCompare(right.analysis_date));
      });
      setSummary(firstPayload?.summary || emptySummary);
      setAnalysis(firstPayload?.analysis || emptyAnalysis);
      const configuredFee = Number(firstPayload?.revenue_policy?.match_fee_amount ?? 0);
      if (!feeLoaded.current && Number.isFinite(configuredFee)) {
        feeLoaded.current = true;
        setMatchFee(configuredFee);
        setMatchFeeDraft(String(configuredFee));
      }
    } catch (reason) {
      if (id === requestId.current) {
        setError(reason instanceof Error ? reason.message : "No se pudo cargar el análisis de partidos.");
      }
    } finally {
      if (id === requestId.current && fullHistory) setLoading(false);
    }
  }, []);

  const loadSchedule = useCallback(async (month: string) => {
    const id = ++scheduleRequestId.current;
    const cells = monthCells(month);
    setScheduleLoading(true);
    setScheduleError("");
    try {
      const payload = await stationApi<MatchScheduleResponse>(`/api/match-schedule?${toQuery({
        start_date: cells[0],
        end_date: cells[cells.length - 1],
      })}`);
      if (id !== scheduleRequestId.current) return;
      setScheduleItems(payload.items || []);
      setScheduleMonth(month);
    } catch (reason) {
      if (id === scheduleRequestId.current) {
        setScheduleItems([]);
        setScheduleMonth("");
        setScheduleError(reason instanceof Error ? reason.message : "No se pudo cargar el calendario autorizado.");
      }
    } finally {
      if (id === scheduleRequestId.current) setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    if (!analysis.running) return;
    const timer = window.setTimeout(() => void loadCalendar(false), 2000);
    return () => window.clearTimeout(timer);
  }, [analysis.running, analysis.processed_days, loadCalendar]);

  useEffect(() => {
    if (analysis.running) {
      pendingFullHistoryRefresh.current = true;
      return;
    }
    if (!pendingFullHistoryRefresh.current) return;
    pendingFullHistoryRefresh.current = false;
    setScheduleMonth("");
    void loadCalendar(true);
  }, [analysis.running, loadCalendar]);

  useEffect(() => {
    if (!currentMonth || scheduleMonth === currentMonth) return;
    void loadSchedule(currentMonth);
  }, [currentMonth, loadSchedule, scheduleMonth]);

  useEffect(() => {
    if (currentMonth) return;
    if (days.length) {
      setCurrentMonth((summary.last_date || days[days.length - 1].analysis_date).slice(0, 7));
    } else if (!loading) {
      setCurrentMonth(isoLocalDate(new Date()).slice(0, 7));
    }
  }, [currentMonth, days, loading, summary.last_date]);

  async function rerunHistory() {
    try {
      const result = await stationApi<{ started: boolean } & MatchAnalysisStatus>("/api/match-analysis/run?force=true", {
        method: "POST",
      });
      setAnalysis(result);
      onNotify(result.started ? "Reanálisis histórico iniciado." : "El análisis histórico ya está en ejecución.");
      window.setTimeout(() => void loadCalendar(false), 500);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "No se pudo iniciar el análisis.", "error");
    }
  }

  async function saveMatchFee() {
    const amount = Number(matchFeeDraft);
    if (!matchFeeDraft.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
      onNotify("La tarifa por partido debe estar entre $0 y $1,000,000.", "error");
      return;
    }
    setSavingMatchFee(true);
    try {
      await stationApi("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ match_fee_amount: amount }),
      });
      setMatchFee(amount);
      setMatchFeeDraft(String(amount));
      onNotify(`Tarifa por partido actualizada a ${currency(amount)}. La detección continuó activa.`);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "No se pudo actualizar la tarifa por partido.", "error");
    } finally {
      setSavingMatchFee(false);
    }
  }

  const analysisProgress = analysis.total_days
    ? `${compactNumber(analysis.processed_days)} de ${compactNumber(analysis.total_days)} días`
    : "Preparando historial";
  const daysByDate = useMemo(() => new Map(days.map((day) => [day.analysis_date, day])), [days]);
  const scheduleByDate = useMemo(() => {
    const grouped = new Map<string, MatchScheduleItem[]>();
    for (const item of scheduleItems) {
      const current = grouped.get(item.match_date) || [];
      current.push(item);
      grouped.set(item.match_date, current);
    }
    for (const items of grouped.values()) items.sort((left, right) => left.starts_at.localeCompare(right.starts_at));
    return grouped;
  }, [scheduleItems]);
  const selectedDay = selectedDate
    ? mergeAnalysisDayWithSchedule(selectedDate, daysByDate.get(selectedDate), scheduleByDate.get(selectedDate) || [])
    : undefined;
  const firstMonth = (summary.first_date || days[0]?.analysis_date || currentMonth).slice(0, 7);
  const lastMonth = (summary.last_date || days[days.length - 1]?.analysis_date || currentMonth).slice(0, 7);

  function changeMonth(delta: number) {
    if (!currentMonth) return;
    const next = localDate(`${currentMonth}-01`);
    next.setMonth(next.getMonth() + delta);
    setCurrentMonth(isoLocalDate(next).slice(0, 7));
  }

  function openDate(date: string, windowId: number | null = null) {
    setCurrentMonth(date.slice(0, 7));
    setSelectedDate(date);
    setSelectedWindowId(windowId);
  }

  function closeDate() {
    setSelectedDate("");
    setSelectedWindowId(null);
  }

  function selectView(next: MatchViewMode) {
    setViewMode(next);
    closeDate();
  }

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-amber-700">Control de uso de cancha</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">Control de partidos</h1>
          <p className="mt-1 max-w-3xl text-xs text-zinc-500">Revisa cuántos partidos tuvieron evidencia, sus horarios y el ingreso estimado. El calendario conserva el detalle completo por día.</p>
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

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div
          ref={tabListRef}
          className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1"
          role="tablist"
          aria-label="Vistas de partidos"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              const next = viewMode === "summary" ? "calendar" : "summary";
              selectView(next);
              window.requestAnimationFrame(() => tabListRef.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus());
            }
          }}
        >
          <MatchViewTab mode="summary" active={viewMode === "summary"} icon={<LayoutDashboard size={14} />} onClick={() => selectView("summary")}>Resumen</MatchViewTab>
          <MatchViewTab mode="calendar" active={viewMode === "calendar"} icon={<CalendarDays size={14} />} onClick={() => selectView("calendar")}>Calendario</MatchViewTab>
        </div>
        <p className="px-2 text-[9px] font-semibold text-zinc-500">
          Historial: {summary.first_date ? `${dateLabel(summary.first_date)} — ${dateLabel(summary.last_date)}` : "pendiente de análisis"}
        </p>
      </div>

      {analysis.running ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-[10px] font-semibold text-blue-800">
          <RefreshCw size={13} className="animate-spin" /> Analizando {analysisProgress}{analysis.current_date ? ` · ${dateLabel(analysis.current_date)}` : ""}. La detección de rostros continúa activa.
        </div>
      ) : analysis.last_error ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[10px] font-semibold text-red-800">
          <AlertTriangle size={13} /> {analysis.last_error}
        </div>
      ) : null}

      {error && days.length ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[10px] font-semibold text-red-800">
          <AlertTriangle size={13} /> {error}
        </div>
      ) : null}

      {loading && !days.length ? (
        <section className={panelClass}><LoadingState label="Consultando historial de partidos..." /></section>
      ) : error && !days.length ? (
        <section className={panelClass}><EmptyState error title="No se pudo abrir el historial" detail={error} /></section>
      ) : !days.length && viewMode === "summary" ? (
        <section className={panelClass}><EmptyState title="Todavía no hay resultados" detail={analysis.running ? "El primer análisis histórico está en curso." : "Ejecuta el análisis para revisar los recortes procesados."} /></section>
      ) : currentMonth && viewMode === "summary" ? (
        <MatchSummaryPanel
          month={currentMonth}
          days={days}
          firstMonth={firstMonth}
          lastMonth={lastMonth}
          matchFee={matchFee}
          matchFeeDraft={matchFeeDraft}
          minimumUniquePeople={analysis.minimum_unique_people}
          schedule={scheduleItems}
          scheduleLoaded={scheduleMonth === currentMonth}
          scheduleLoading={scheduleLoading}
          scheduleError={scheduleError}
          savingMatchFee={savingMatchFee}
          onMatchFeeDraftChange={setMatchFeeDraft}
          onSaveMatchFee={() => void saveMatchFee()}
          onPrevious={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          onLatest={() => setCurrentMonth(lastMonth)}
          onOpenWindow={openDate}
        />
      ) : currentMonth ? (
        <section id="match-view-panel-calendar" className={panelClass} role="tabpanel" aria-labelledby="match-view-tab-calendar">
          <div className="flex flex-col gap-3 border-b border-zinc-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Calendario mensual</h2>
              <p className="mt-0.5 text-[9px] text-zinc-500">Selecciona un día para abrir su línea de tiempo y consultar la evidencia.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[8px] font-bold text-zinc-500" aria-label="Leyenda del calendario">
              <CalendarLegend tone="bg-amber-500" label="Programado" />
              <CalendarLegend tone="bg-emerald-500" label="Con evidencia" />
              <CalendarLegend tone="bg-red-500" label="Fuera de horario" />
              <CalendarLegend tone="bg-zinc-300" label="Sin datos" />
            </div>
          </div>
          {scheduleLoading ? <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2.5 text-[9px] font-semibold text-blue-800"><RefreshCw size={12} className="animate-spin" /> Cargando horarios autorizados del mes...</div> : null}
          {scheduleError ? <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5 text-[9px] font-semibold text-red-800"><AlertTriangle size={12} /> {scheduleError}</div> : null}
          <div className="bg-zinc-50/70 p-3 sm:p-4">
            <MatchMonthCalendar
              month={currentMonth}
              daysByDate={daysByDate}
              scheduleByDate={scheduleByDate}
              scheduleLoaded={scheduleMonth === currentMonth}
              firstMonth={firstMonth}
              lastMonth={lastMonth}
              onPrevious={() => changeMonth(-1)}
              onNext={() => changeMonth(1)}
              onLatest={() => setCurrentMonth(lastMonth)}
              onOpenDate={openDate}
            />
          </div>
        </section>
      ) : null}

      <section className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Regla de detección">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-900 text-amber-100"><Trophy size={17} /></span>
          <div>
            <p className="text-[8px] font-extrabold uppercase tracking-[0.16em] text-amber-800">Regla activa</p>
            <strong className="mt-0.5 block text-xs text-amber-950">{analysis.minimum_unique_people} personas en una ventana de {analysis.window_minutes} min · tolerancia de horario ±{analysis.schedule_tolerance_minutes || 15} min</strong>
            <p className="mt-0.5 text-[9px] text-amber-900/65">Los colaboradores no cuentan. Los horarios sin evidencia se conservan en calendario, pero no generan ingreso estimado.</p>
          </div>
        </div>
        <span className="shrink-0 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[9px] font-bold text-amber-900">Detección local · mañana, tarde y noche</span>
      </section>

      {selectedDate ? (
        <MatchDayTimelineDialog
          date={selectedDate}
          day={selectedDay}
          initialWindowId={selectedWindowId}
          onClose={closeDate}
          onSelectDate={openDate}
        />
      ) : null}
    </div>
  );
}

function MatchViewTab({ mode, active, icon, onClick, children }: { mode: MatchViewMode; active: boolean; icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      id={`match-view-tab-${mode}`}
      data-view={mode}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`match-view-panel-${mode}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-4 text-[10px] font-extrabold transition ${active ? "bg-white text-amber-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-500 hover:text-zinc-800"}`}
    >
      {icon}{children}
    </button>
  );
}

function scheduleWindow(item: MatchScheduleItem, date: string, index: number): MatchWindow {
  return {
    id: item.analysis_window_id ? Number(item.analysis_window_id) : -(10_000_000_000 + Math.abs(Number(item.id))),
    analysis_date: date,
    window_index: index,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    duration_minutes: Number(item.expected_duration_minutes || 50),
    max_unique_people: Number(item.participant_count || 0),
    participant_count: Number(item.participant_count || 0),
    known_count: Number(item.known_count || 0),
    unknown_count: Number(item.unknown_count || 0),
    participants: [],
    window_type: "scheduled",
    window_status: !item.analysis_status || item.analysis_status === "pending_analysis" ? "scheduled" : item.analysis_status,
    schedule_id: item.id,
    tournament: item.tournament || "",
    home_team: item.home_team || "",
    away_team: item.away_team || "",
    scheduled_starts_at: item.starts_at,
    scheduled_ends_at: item.ends_at,
    evidence_starts_at: item.evidence_starts_at || "",
    evidence_ends_at: item.evidence_ends_at || "",
    tolerance_minutes: Number(item.tolerance_minutes || 0),
  };
}

function mergeAnalysisDayWithSchedule(date: string, day: MatchAnalysisDay | undefined, schedule: MatchScheduleItem[]): MatchAnalysisDay | undefined {
  if (!schedule.length) return day;
  const existingWindows = day?.windows || [];
  const existingWindowIds = new Set(existingWindows.map((window) => window.id));
  const existingScheduleIds = new Set(existingWindows.map((window) => window.schedule_id).filter((id) => id != null));
  const syntheticWindows = schedule
    .filter((item) => !existingScheduleIds.has(item.id) && !(item.analysis_window_id && existingWindowIds.has(item.analysis_window_id)))
    .map((item, index) => scheduleWindow(item, date, existingWindows.length + index));
  const windows = [...existingWindows, ...syntheticWindows].sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  const confirmed = schedule.filter((item) => item.analysis_status === "scheduled_with_evidence").length;
  if (day) return { ...day, scheduled_count: schedule.length, scheduled_confirmed_count: confirmed, windows };
  return {
    analysis_date: date,
    status: "complete",
    match_detected: confirmed > 0,
    window_count: confirmed,
    scheduled_count: schedule.length,
    scheduled_confirmed_count: confirmed,
    unscheduled_count: 0,
    max_unique_people: Math.max(0, ...schedule.map((item) => Number(item.participant_count || 0))),
    source_crop_count: 0,
    source_queue_count: 0,
    unresolved_queue_count: 0,
    windows,
  };
}

interface SummaryDayRow {
  date: string;
  windows: MatchWindow[];
}

function MatchSummaryPanel({
  month,
  days,
  firstMonth,
  lastMonth,
  matchFee,
  matchFeeDraft,
  minimumUniquePeople,
  schedule,
  scheduleLoaded,
  scheduleLoading,
  scheduleError,
  savingMatchFee,
  onMatchFeeDraftChange,
  onSaveMatchFee,
  onPrevious,
  onNext,
  onLatest,
  onOpenWindow,
}: {
  month: string;
  days: MatchAnalysisDay[];
  firstMonth: string;
  lastMonth: string;
  matchFee: number;
  matchFeeDraft: string;
  minimumUniquePeople: number;
  schedule: MatchScheduleItem[];
  scheduleLoaded: boolean;
  scheduleLoading: boolean;
  scheduleError: string;
  savingMatchFee: boolean;
  onMatchFeeDraftChange: (value: string) => void;
  onSaveMatchFee: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onLatest: () => void;
  onOpenWindow: (date: string, windowId?: number | null) => void;
}) {
  const monthDays = days.filter((day) => day.analysis_date.startsWith(month));
  const completeMonthDays = monthDays.filter((day) => day.status === "complete");
  const processingDays = monthDays.length - completeMonthDays.length;
  const processingDates = new Set(monthDays.filter((day) => day.status !== "complete").map((day) => day.analysis_date));
  const inScheduleRows = summaryDayRows(completeMonthDays, "scheduled", minimumUniquePeople);
  const outsideRows = summaryDayRows(completeMonthDays, "unscheduled", minimumUniquePeople);
  const inScheduleCount = countSummaryWindows(inScheduleRows);
  const outsideCount = countSummaryWindows(outsideRows);
  const elapsedSchedule = scheduleLoaded
    ? schedule.filter((item) => item.match_date.startsWith(month)
      && !processingDates.has(item.match_date)
      && new Date(item.ends_at).getTime() + Number(item.tolerance_minutes || 0) * 60_000 <= Date.now())
    : [];
  const scheduledSlotCount = scheduleLoaded
    ? elapsedSchedule.length
    : completeMonthDays.reduce((total, day) => total + Number(day.scheduled_count || 0), 0);
  const unconfirmedCount = Math.max(0, scheduledSlotCount - inScheduleCount);
  const detectedCount = inScheduleCount + outsideCount;

  return (
    <section id="match-view-panel-summary" className={panelClass} role="tabpanel" aria-labelledby="match-view-tab-summary">
      <div className="flex flex-col gap-4 border-b border-zinc-200 bg-white px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Mes anterior" disabled={month <= firstMonth} onClick={onPrevious} className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft size={16} /></button>
          <div className="min-w-44 text-center">
            <p className="text-[8px] font-extrabold uppercase tracking-widest text-amber-700">Resumen del mes</p>
            <h2 className="text-lg font-extrabold text-zinc-900">{monthTitle(month)}</h2>
          </div>
          <button type="button" aria-label="Mes siguiente" disabled={month >= lastMonth} onClick={onNext} className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight size={16} /></button>
          {month !== lastMonth ? <button type="button" onClick={onLatest} className="ml-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[8px] font-extrabold text-amber-800">Último mes</button> : null}
        </div>
        <form
          className="flex flex-col gap-1.5 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveMatchFee();
          }}
        >
          <label className="block">
            <span className="block text-[8px] font-extrabold uppercase tracking-wider text-zinc-500">Tarifa estimada por partido</span>
            <span className="mt-1 flex min-h-9 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-100">
              <span className="mr-1 text-xs font-bold text-zinc-400">$</span>
              <input className="w-28 bg-transparent text-xs font-bold tabular-nums text-zinc-800 outline-none" inputMode="decimal" min="0" max="1000000" step="0.01" type="number" value={matchFeeDraft} onChange={(event) => onMatchFeeDraftChange(event.target.value)} />
              <span className="ml-1 text-[8px] font-bold text-zinc-400">MXN</span>
            </span>
          </label>
          <button type="submit" disabled={savingMatchFee} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-900 px-3 text-[9px] font-extrabold text-white transition hover:bg-amber-950 disabled:cursor-wait disabled:opacity-60">
            {savingMatchFee ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}{savingMatchFee ? "Guardando" : "Guardar tarifa"}
          </button>
        </form>
      </div>

      {scheduleLoading ? <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2.5 text-[9px] font-semibold text-blue-800"><RefreshCw size={12} className="animate-spin" /> Completando horarios autorizados del mes...</div> : null}
      {scheduleError ? <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5 text-[9px] font-semibold text-red-800"><AlertTriangle size={12} /> El conteo de horarios sin evidencia es parcial: {scheduleError}</div> : null}

      <div className="bg-zinc-50/70 p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric label="En horario" value={compactNumber(inScheduleCount)} detail="Partidos con evidencia" tone="emerald" icon={<CheckCircle2 size={17} />} />
          <SummaryMetric label="Fuera de horario" value={compactNumber(outsideCount)} detail="Alertas que parecen partido" tone={outsideCount ? "red" : "zinc"} icon={<AlertTriangle size={17} />} />
          <SummaryMetric label="Sin evidencia suficiente" value={compactNumber(unconfirmedCount)} detail={`Menos de ${compactNumber(minimumUniquePeople)} personas`} tone="amber" icon={<Clock3 size={17} />} />
          <SummaryMetric label="Ingreso estimado" value={currency(detectedCount * matchFee)} detail={`${compactNumber(detectedCount)} partidos × ${currency(matchFee)}`} tone="blue" icon={<Banknote size={17} />} />
        </div>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
          <MatchSummaryGroup
            title="Dentro del horario de torneo"
            detail={`Partidos programados con al menos ${compactNumber(minimumUniquePeople)} personas.`}
            rows={inScheduleRows}
            fee={matchFee}
            tone="scheduled"
            onOpenWindow={onOpenWindow}
          />
          <MatchSummaryGroup
            title="Fuera del horario autorizado"
            detail={`Actividad de ${compactNumber(minimumUniquePeople)} o más personas sin un horario asociado.`}
            rows={outsideRows}
            fee={matchFee}
            tone="outside"
            onOpenWindow={onOpenWindow}
          />
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[9px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span><strong className="text-zinc-800">Cómo se calcula:</strong> partidos con evidencia × tarifa vigente. Los {compactNumber(unconfirmedCount)} horarios sin evidencia quedan visibles en Calendario, pero no se cobran.{processingDays ? ` ${compactNumber(processingDays)} día(s) en proceso tampoco se incluyen.` : ""}</span>
          {matchFee <= 0 ? <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 font-extrabold text-amber-800">Define una tarifa para ver montos</span> : null}
        </div>
      </div>
    </section>
  );
}

function summaryDayRows(days: MatchAnalysisDay[], kind: "scheduled" | "unscheduled", minimumUniquePeople: number): SummaryDayRow[] {
  return days
    .map((day) => ({
      date: day.analysis_date,
      windows: [...(day.windows || [])]
        .filter((window) => kind === "scheduled"
          ? window.window_type === "scheduled"
            && window.window_status === "scheduled_with_evidence"
            && Number(window.max_unique_people || 0) >= minimumUniquePeople
          : window.window_type === "unscheduled" && Number(window.participant_count || 0) >= minimumUniquePeople)
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at)),
    }))
    .filter((row) => row.windows.length > 0)
    .sort((left, right) => right.date.localeCompare(left.date));
}

function countSummaryWindows(rows: SummaryDayRow[]) {
  return rows.reduce((total, row) => total + row.windows.length, 0);
}

function SummaryMetric({ label, value, detail, tone, icon }: { label: string; value: string; detail: string; tone: "emerald" | "red" | "amber" | "blue" | "zinc"; icon: React.ReactNode }) {
  const styles = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    zinc: "border-zinc-200 bg-zinc-50 text-zinc-500",
  };
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[8px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</p><strong className="mt-1 block truncate text-xl font-extrabold tabular-nums text-zinc-900">{value}</strong></div>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl border ${styles[tone]}`}>{icon}</span>
      </div>
      <p className="mt-2 truncate text-[9px] font-medium text-zinc-500">{detail}</p>
    </article>
  );
}

function MatchSummaryGroup({ title, detail, rows, fee, tone, onOpenWindow }: { title: string; detail: string; rows: SummaryDayRow[]; fee: number; tone: "scheduled" | "outside"; onOpenWindow: (date: string, windowId?: number | null) => void }) {
  const total = countSummaryWindows(rows);
  const accent = tone === "scheduled" ? "text-emerald-700" : "text-red-700";
  const badge = tone === "scheduled" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800";
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3.5">
        <div className="min-w-0">
          <p className={`text-[8px] font-extrabold uppercase tracking-widest ${accent}`}>{tone === "scheduled" ? "Horario torneo" : "Alerta de uso"}</p>
          <h3 className="mt-0.5 text-sm font-extrabold text-zinc-900">{title}</h3>
          <p className="mt-1 text-[9px] text-zinc-500">{detail}</p>
        </div>
        <span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-center ${badge}`}><strong className="block text-sm tabular-nums">{compactNumber(total)}</strong><span className="block text-[7px] font-extrabold uppercase">partidos</span></span>
      </header>
      {rows.length ? (
        <div className="station-scrollbar divide-y divide-zinc-100 xl:max-h-[430px] xl:overflow-y-auto">
          {rows.map((row) => (
            <article key={row.date} className="grid gap-3 px-4 py-3 transition hover:bg-zinc-50 sm:grid-cols-[120px_minmax(0,1fr)_88px] sm:items-center">
              <div>
                <strong className="block text-[10px] text-zinc-800">{dateLabel(row.date)}</strong>
                <span className="mt-0.5 block text-[8px] font-semibold text-zinc-400">{compactNumber(row.windows.length)} {row.windows.length === 1 ? "partido" : "partidos"}</span>
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5" aria-label={`Horarios de ${dateLabel(row.date)}`}>
                {row.windows.map((window) => (
                  <button key={window.id} type="button" onClick={() => onOpenWindow(row.date, window.id)} className={`rounded-md border px-2 py-1 text-[8px] font-bold transition ${tone === "scheduled" ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"}`} title={`Abrir evidencia de ${timeLabel(window.starts_at)}`}>
                    {dayPeriodLabel(window.starts_at)} · {timeLabel(window.starts_at)}
                  </button>
                ))}
              </div>
              <button type="button" aria-label={`Abrir primer partido de ${dateLabel(row.date)}; estimado ${currency(row.windows.length * fee)}`} onClick={() => onOpenWindow(row.date, row.windows[0]?.id)} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-left transition hover:border-amber-300 hover:bg-amber-50">
                <span><span className="block text-[7px] font-extrabold uppercase text-zinc-400">Estimado</span><strong className="text-[10px] tabular-nums text-zinc-800">{currency(row.windows.length * fee)}</strong></span>
                <ChevronRight size={13} className="text-zinc-400" />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center px-5 py-8 text-center"><CheckCircle2 size={22} className={tone === "scheduled" ? "text-zinc-300" : "text-emerald-500"} /><strong className="mt-2 text-xs text-zinc-700">{tone === "scheduled" ? "Sin partidos confirmados" : "Sin partidos fuera de horario"}</strong><p className="mt-1 text-[9px] text-zinc-400">No hay actividad de este tipo en el mes seleccionado.</p></div>
      )}
      <footer className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-3">
        <span className="text-[8px] font-extrabold uppercase tracking-wider text-zinc-500">Total estimado</span>
        <strong className={`text-base tabular-nums ${accent}`}>{currency(total * fee)}</strong>
      </footer>
    </section>
  );
}

function dayPeriodLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Horario";
  const hour = parsed.getHours();
  if (hour < 12) return "Mañana";
  if (hour < 19) return "Tarde";
  return "Noche";
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
  scheduleByDate,
  scheduleLoaded,
  firstMonth,
  lastMonth,
  onPrevious,
  onNext,
  onLatest,
  onOpenDate,
}: {
  month: string;
  daysByDate: Map<string, MatchAnalysisDay>;
  scheduleByDate: Map<string, MatchScheduleItem[]>;
  scheduleLoaded: boolean;
  firstMonth: string;
  lastMonth: string;
  onPrevious: () => void;
  onNext: () => void;
  onLatest: () => void;
  onOpenDate: (date: string) => void;
}) {
  const cells = monthCells(month);
  const monthDays = Array.from(daysByDate.values()).filter((day) => day.analysis_date.startsWith(month));
  const monthSchedule = Array.from(scheduleByDate.values()).flat().filter((item) => item.match_date.startsWith(month));
  const scheduled = scheduleLoaded ? monthSchedule.length : monthDays.reduce((sum, day) => sum + Number(day.scheduled_count || 0), 0);
  const confirmed = scheduleLoaded
    ? monthSchedule.filter((item) => item.analysis_status === "scheduled_with_evidence").length
    : monthDays.reduce((sum, day) => sum + Number(day.scheduled_confirmed_count || 0), 0);
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
            schedule={scheduleByDate.get(date) || []}
            scheduleLoaded={scheduleLoaded}
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

function CalendarDay({ date, day, schedule, scheduleLoaded, inMonth, onOpen }: { date: string; day?: MatchAnalysisDay; schedule: MatchScheduleItem[]; scheduleLoaded: boolean; inMonth: boolean; onOpen: () => void }) {
  const processing = Boolean(day && day.status !== "complete");
  const outside = Number(day?.unscheduled_count || 0);
  const scheduled = scheduleLoaded ? schedule.length : Number(day?.scheduled_count || 0);
  const confirmed = scheduleLoaded
    ? schedule.filter((item) => item.analysis_status === "scheduled_with_evidence").length
    : Number(day?.scheduled_confirmed_count || 0);
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
      {inMonth && (day || scheduled) ? (
        <div className="mt-1.5 space-y-1">
          {processing ? <span className="inline-flex items-center gap-1 text-[7px] font-extrabold text-blue-700"><RefreshCw size={9} className="animate-spin" /> Procesando</span> : null}
          {scheduled ? <p className="truncate text-[7px] font-bold text-blue-700 sm:text-[8px]">{scheduled} programados</p> : null}
          {confirmed ? <p className="truncate text-[7px] font-bold text-emerald-700 sm:text-[8px]">{confirmed} con evidencia</p> : null}
          {outside ? <p className="inline-flex max-w-full items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[7px] font-extrabold text-white sm:text-[8px]"><AlertTriangle size={8} /> {outside} fuera</p> : null}
          {day ? <p className="hidden truncate text-[7px] text-zinc-400 sm:block">{compactNumber(day.source_crop_count)} recortes</p> : <p className="hidden truncate text-[7px] font-semibold text-amber-700 sm:block">Pendiente de análisis</p>}
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
  initialWindowId,
  onClose,
  onSelectDate,
}: {
  date: string;
  day?: MatchAnalysisDay;
  initialWindowId?: number | null;
  onClose: () => void;
  onSelectDate: (date: string) => void;
}) {
  const sortedWindows = useMemo(() => [...(day?.windows || [])].sort((left, right) => left.starts_at.localeCompare(right.starts_at)), [day]);
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);

  useEffect(() => {
    const preferred = sortedWindows.find((window) => window.id === initialWindowId)
      || sortedWindows.find((window) => window.window_type === "unscheduled")
      || sortedWindows.find((window) => window.participant_count > 0)
      || sortedWindows[0];
    setSelectedWindowId(preferred?.id ?? null);
  }, [date, initialWindowId, sortedWindows]);

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
        : window.window_status === "scheduled_insufficient_evidence"
          ? "Horario programado · evidencia insuficiente"
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
