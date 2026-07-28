import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";
import { apiRequest } from "../../api";
import type { Site } from "../../types";

const PAGE_SIZE = 12;

type SubjectKind = "known" | "unknown";

type MonthlyAttendanceRow = {
  subject_kind: SubjectKind;
  subject_key: string;
  linked_person_key?: string | null;
  status?: string;
  name: string;
  person_type?: string;
  group_name?: string;
  team_name?: string;
  attendance_days: number;
  session_count: number;
  first_date: string;
  last_date: string;
  detection_count: number;
  payment_applicable?: boolean;
  payment_registered?: boolean;
  payment_count?: number;
  payment_amount?: number;
  last_paid_at?: string;
  fee_applicable?: boolean;
  expected_fee_eligible?: boolean;
  expected_fee_minimum_days?: number;
  expected_monthly_amount?: number;
};

type MonthlySummary = {
  people: number;
  known: number;
  unknown: number;
  attendance_days: number;
  sessions?: number;
  detections?: number;
  expected_payers?: number;
  expected_revenue?: number;
  payment_registered?: number;
  payment_missing?: number;
};

type MonthlyResponse = {
  available: boolean;
  month: string;
  items: MonthlyAttendanceRow[];
  total: number;
  offset: number;
  limit: number;
  summary: MonthlySummary;
  revenue_policy: {
    monthly_fee_amount: number;
    minimum_attendance_days?: number;
    registered_minimum_attendance_days?: number;
    unknown_minimum_attendance_days?: number;
  };
  site_id?: number;
  site_name?: string;
  synced_at?: string;
  generated_at?: string;
  report_days?: number;
  finalized?: boolean;
};

type SectionState = {
  rows: MonthlyAttendanceRow[];
  total: number;
  summary: MonthlySummary;
  loading: boolean;
  loadingMore: boolean;
  error: string;
};

const emptySummary: MonthlySummary = {
  people: 0,
  known: 0,
  unknown: 0,
  attendance_days: 0,
};

const emptySection: SectionState = {
  rows: [],
  total: 0,
  summary: emptySummary,
  loading: true,
  loadingMore: false,
  error: "",
};

function currentMonth() {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}

function buildMonthlyPath({
  month,
  siteId,
  query,
  kind,
  offset,
  limit,
}: {
  month: string;
  siteId: number;
  query: string;
  kind: "all" | SubjectKind;
  offset: number;
  limit: number;
}) {
  const params = new URLSearchParams({
    month,
    site: String(siteId),
    q: query,
    kind,
    offset: String(offset),
    limit: String(limit),
  });
  return `/face-station/reports/monthly/?${params.toString()}`;
}

function formatCurrency(value: number | string | undefined) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value: number | string | undefined) {
  return Number(value || 0).toLocaleString("es-MX");
}

function formatMonth(value: string) {
  const parsed = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const label = parsed.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatDate(value: string | undefined) {
  if (!value) return "Sin fecha";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function formatDateTime(value: string | undefined) {
  if (!value) return "Pendiente de sincronización";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Pendiente de sincronización";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}

function personTypeLabel(value?: string) {
  return (
    {
      student: "Alumno",
      player: "Jugador",
      collaborator: "Colaborador",
      coach: "Entrenador",
      staff: "Personal",
    }[value || ""] || "Persona registrada"
  );
}

function useDebouncedValue(value: string, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function useMonthlySection({
  token,
  month,
  siteId,
  query,
  kind,
  refreshKey,
}: {
  token: string;
  month: string;
  siteId: number | null;
  query: string;
  kind: SubjectKind;
  refreshKey: number;
}) {
  const [state, setState] = useState<SectionState>(emptySection);
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    if (!siteId) {
      setState({ ...emptySection, loading: false });
      return;
    }
    setState((current) => ({
      ...current,
      rows: [],
      total: 0,
      loading: true,
      loadingMore: false,
      error: "",
    }));
    try {
      const payload = await apiRequest<MonthlyResponse>(
        buildMonthlyPath({
          month,
          siteId,
          query,
          kind,
          offset: 0,
          limit: PAGE_SIZE,
        }),
        token,
      );
      if (id !== requestId.current) return;
      setState({
        rows: payload.items || [],
        total: Number(payload.total || 0),
        summary: payload.summary || emptySummary,
        loading: false,
        loadingMore: false,
        error: "",
      });
    } catch (reason) {
      if (id !== requestId.current) return;
      setState({
        ...emptySection,
        loading: false,
        error:
          reason instanceof Error
            ? reason.message
            : `No se pudo cargar la sección ${kind === "known" ? "de reconocidos" : "de no reconocidos"}.`,
      });
    }
  }, [kind, month, query, siteId, token]);

  useEffect(() => {
    void refreshKey;
    void loadFirstPage();
  }, [loadFirstPage, refreshKey]);

  const loadMore = useCallback(async () => {
    if (!siteId || state.loading || state.loadingMore || state.rows.length >= state.total) return;
    const id = requestId.current;
    setState((current) => ({ ...current, loadingMore: true, error: "" }));
    try {
      const payload = await apiRequest<MonthlyResponse>(
        buildMonthlyPath({
          month,
          siteId,
          query,
          kind,
          offset: state.rows.length,
          limit: PAGE_SIZE,
        }),
        token,
      );
      if (id !== requestId.current) return;
      setState((current) => ({
        ...current,
        rows: [...current.rows, ...(payload.items || [])],
        total: Number(payload.total || current.total),
        summary: payload.summary || current.summary,
        loadingMore: false,
      }));
    } catch (reason) {
      if (id !== requestId.current) return;
      setState((current) => ({
        ...current,
        loadingMore: false,
        error: reason instanceof Error ? reason.message : "No se pudo cargar la siguiente página.",
      }));
    }
  }, [kind, month, query, siteId, state.loading, state.loadingMore, state.rows.length, state.total, token]);

  return { ...state, loadFirstPage, loadMore };
}

export function FaceGuardMonthlyReport({
  token,
  sites,
  preferredSiteId,
}: {
  token: string;
  sites: Site[];
  preferredSiteId?: number | null;
}) {
  const selectableSites = useMemo(
    () => sites.filter((site) => site.is_active).sort((a, b) => a.name.localeCompare(b.name, "es")),
    [sites],
  );
  const [month, setMonth] = useState(currentMonth);
  const [siteId, setSiteId] = useState<number | null>(() => {
    if (preferredSiteId && sites.some((site) => site.id === preferredSiteId)) return preferredSiteId;
    return sites.find((site) => site.is_active)?.id ?? sites[0]?.id ?? null;
  });
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const [refreshKey, setRefreshKey] = useState(0);
  const [overview, setOverview] = useState<MonthlyResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const overviewRequestId = useRef(0);

  useEffect(() => {
    if (siteId && selectableSites.some((site) => site.id === siteId)) return;
    const preferred = preferredSiteId
      ? selectableSites.find((site) => site.id === preferredSiteId)
      : undefined;
    setSiteId(preferred?.id ?? selectableSites[0]?.id ?? null);
  }, [preferredSiteId, selectableSites, siteId]);

  const loadOverview = useCallback(async () => {
    const id = ++overviewRequestId.current;
    if (!siteId) {
      setOverview(null);
      setOverviewLoading(false);
      setOverviewError("");
      return;
    }
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const payload = await apiRequest<MonthlyResponse>(
        buildMonthlyPath({
          month,
          siteId,
          query: "",
          kind: "all",
          offset: 0,
          limit: 1,
        }),
        token,
      );
      if (id !== overviewRequestId.current) return;
      setOverview(payload);
    } catch (reason) {
      if (id !== overviewRequestId.current) return;
      setOverview(null);
      setOverviewError(reason instanceof Error ? reason.message : "No se pudo consultar el resumen mensual.");
    } finally {
      if (id === overviewRequestId.current) setOverviewLoading(false);
    }
  }, [month, siteId, token]);

  useEffect(() => {
    void refreshKey;
    void loadOverview();
  }, [loadOverview, refreshKey]);

  const known = useMonthlySection({
    token,
    month,
    siteId,
    query,
    kind: "known",
    refreshKey,
  });
  const unknown = useMonthlySection({
    token,
    month,
    siteId,
    query,
    kind: "unknown",
    refreshKey,
  });

  const selectedSite = selectableSites.find((site) => site.id === siteId);
  const summary = overview?.summary || emptySummary;
  const policy = overview?.revenue_policy;
  const registeredMinimumDays = Number(policy?.registered_minimum_attendance_days ?? 1);
  const unknownMinimumDays = Number(
    policy?.unknown_minimum_attendance_days ?? policy?.minimum_attendance_days ?? 3,
  );
  const refreshing = overviewLoading || known.loading || unknown.loading;

  return (
    <section className="grid gap-5" data-testid="faceguard-monthly-report">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
            <ShieldCheck size={16} />
            FaceGuard
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
            Resumen mensual de asistencia
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Cada identidad cuenta una sola vez por día, aunque la cámara la detecte varias veces.
            El reporte se actualiza con la sincronización diaria de la estación.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(210px,1fr)_minmax(170px,0.7fr)_auto] xl:w-auto">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            Sede
            <span className="relative mt-1.5 block">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
              <select
                className="min-h-11 w-full appearance-none rounded-xl border border-zinc-200 bg-white pl-9 pr-9 text-sm font-semibold text-zinc-800 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                data-testid="faceguard-monthly-site"
                disabled={!selectableSites.length}
                onChange={(event) => setSiteId(event.target.value ? Number(event.target.value) : null)}
                value={siteId ?? ""}
              >
                {!selectableSites.length ? <option value="">Sin sedes disponibles</option> : null}
                {selectableSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            Mes
            <input
              className="mt-1.5 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              data-testid="faceguard-monthly-month"
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              type="month"
              value={month}
            />
          </label>
          <button
            className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/40"
            data-testid="faceguard-monthly-refresh"
            disabled={refreshing || !siteId}
            onClick={() => setRefreshKey((current) => current + 1)}
            type="button"
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} size={15} />
            Actualizar
          </button>
        </div>
      </header>

      {!selectableSites.length ? (
        <MessageCard
          icon={<MapPin size={21} />}
          title="No hay una sede disponible"
          detail="Tu usuario necesita acceso a una sede activa para consultar el reporte de FaceGuard."
          tone="warning"
        />
      ) : overviewError ? (
        <MessageCard
          icon={<AlertTriangle size={21} />}
          title="No se pudo abrir el reporte mensual"
          detail={overviewError}
          tone="error"
          action={
            <button
              className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800"
              onClick={() => setRefreshKey((current) => current + 1)}
              type="button"
            >
              Reintentar
            </button>
          }
        />
      ) : (
        <>
          <article className="relative overflow-hidden rounded-2xl border border-emerald-800/50 bg-gradient-to-br from-zinc-950 via-emerald-950 to-emerald-800 text-white shadow-xl shadow-emerald-950/10">
            <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-emerald-300/10 blur-3xl" />
            <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-center">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-emerald-200 shadow-inner">
                  <Banknote size={24} />
                </span>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-200">
                    Ingreso mensual esperado
                  </p>
                  {overviewLoading && !overview ? (
                    <div className="mt-3 h-10 w-48 animate-pulse rounded-lg bg-white/15" />
                  ) : (
                    <strong className="mt-1 block text-4xl font-black tracking-tight tabular-nums sm:text-5xl">
                      {formatCurrency(summary.expected_revenue)}
                    </strong>
                  )}
                  <p className="mt-2 text-sm text-emerald-100/80">
                    {formatNumber(summary.expected_payers)} identidades generan cuota en {formatMonth(month)}.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm sm:grid-cols-2">
                <PolicyValue
                  label="Cuota por identidad"
                  value={formatCurrency(policy?.monthly_fee_amount ?? 1000)}
                />
                <PolicyValue
                  label="Regla de asistencia"
                  value={`${registeredMinimumDays} día registrados · ${unknownMinimumDays} desconocidos`}
                />
                <div className="sm:col-span-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100/60">
                    Estado del reporte
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-semibold">
                      <CalendarDays size={12} />
                      {formatNumber(overview?.report_days)} días sincronizados
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-semibold">
                      <Clock3 size={12} />
                      {formatDateTime(overview?.synced_at)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${
                        overview?.finalized ? "bg-emerald-300/20 text-emerald-100" : "bg-amber-300/20 text-amber-100"
                      }`}
                    >
                      {overview?.finalized ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                      {overview?.finalized ? "Datos cerrados" : "Actualización parcial"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </article>

          {!overviewLoading && overview && !overview.available ? (
            <MessageCard
              icon={<CalendarDays size={21} />}
              title={`Todavía no hay datos de ${formatMonth(month)}`}
              detail={`FaceGuard aún no ha sincronizado un cierre diario para ${selectedSite?.name || "esta sede"}. La pantalla se llenará automáticamente al recibir el primer reporte.`}
              tone="neutral"
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Métricas del mes">
                <MetricCard
                  accent="emerald"
                  detail="Con asistencia en el mes"
                  icon={<UsersRound size={18} />}
                  label="Personas"
                  loading={overviewLoading}
                  value={formatNumber(summary.people)}
                />
                <MetricCard
                  accent="blue"
                  detail="Identidades de la base"
                  icon={<ShieldCheck size={18} />}
                  label="Reconocidos"
                  loading={overviewLoading}
                  value={formatNumber(summary.known)}
                />
                <MetricCard
                  accent="violet"
                  detail="Identidades consolidadas"
                  icon={<UserRound size={18} />}
                  label="No reconocidos"
                  loading={overviewLoading}
                  value={formatNumber(summary.unknown)}
                />
                <MetricCard
                  accent="amber"
                  detail="Días-persona acumulados"
                  icon={<CalendarDays size={18} />}
                  label="Asistencias"
                  loading={overviewLoading}
                  value={formatNumber(summary.attendance_days)}
                />
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-base font-black text-zinc-950 dark:text-zinc-50">Personas del mes</h2>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Busca por nombre, grupo, equipo o identificador de FaceGuard.
                    </p>
                  </div>
                  <label className="relative block w-full lg:max-w-xl">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                    <input
                      className="min-h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-4 text-sm font-medium text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:bg-zinc-950"
                      data-testid="faceguard-monthly-search"
                      maxLength={100}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Ej. Ana, Desconocido 3187 o Sub 15"
                      type="search"
                      value={search}
                    />
                  </label>
                </div>
              </div>

              <div className="grid items-start gap-5 2xl:grid-cols-2">
                <IdentitySection
                  accent="emerald"
                  kind="known"
                  month={month}
                  state={known}
                />
                <IdentitySection
                  accent="violet"
                  kind="unknown"
                  month={month}
                  state={unknown}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function PolicyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100/60">{label}</p>
      <strong className="mt-1 block text-sm font-extrabold text-white">{value}</strong>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent: "emerald" | "blue" | "violet" | "amber";
  loading: boolean;
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  };
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
        <span className={`grid size-9 place-items-center rounded-xl ${tones[accent]}`}>{icon}</span>
      </div>
      {loading ? (
        <div className="mt-4 h-8 w-20 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <strong className="mt-3 block text-3xl font-black tracking-tight tabular-nums text-zinc-950 dark:text-zinc-50">
          {value}
        </strong>
      )}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>
    </article>
  );
}

function IdentitySection({
  kind,
  month,
  accent,
  state,
}: {
  kind: SubjectKind;
  month: string;
  accent: "emerald" | "violet";
  state: ReturnType<typeof useMonthlySection>;
}) {
  const recognized = kind === "known";
  const tone =
    accent === "emerald"
      ? {
          border: "border-emerald-200 dark:border-emerald-900",
          header: "from-emerald-50 to-white dark:from-emerald-950/50 dark:to-zinc-950",
          icon: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200",
          total: "text-emerald-800 dark:text-emerald-300",
          button: "hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-200",
        }
      : {
          border: "border-violet-200 dark:border-violet-900",
          header: "from-violet-50 to-white dark:from-violet-950/50 dark:to-zinc-950",
          icon: "bg-violet-100 text-violet-800 dark:bg-violet-900/70 dark:text-violet-200",
          total: "text-violet-800 dark:text-violet-300",
          button: "hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 dark:hover:border-violet-800 dark:hover:bg-violet-950/50 dark:hover:text-violet-200",
        };
  const title = recognized ? "Reconocidos" : "No reconocidos";
  const detail = recognized
    ? "Alumnos, jugadores y colaboradores identificados"
    : "Identidades locales consolidadas por FaceGuard";

  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-zinc-950 ${tone.border}`}>
      <header className={`border-b border-zinc-100 bg-gradient-to-r p-4 dark:border-zinc-800 sm:p-5 ${tone.header}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone.icon}`}>
              {recognized ? <ShieldCheck size={19} /> : <UserRound size={19} />}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-black text-zinc-950 dark:text-zinc-50">{title}</h3>
              <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{detail}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Ingreso esperado</p>
            <strong className={`block text-xl font-black tabular-nums ${tone.total}`}>
              {formatCurrency(state.summary.expected_revenue)}
            </strong>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
          <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-900/80">
            {formatNumber(state.total)} personas
          </span>
          <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-900/80">
            {formatNumber(state.summary.attendance_days)} asistencias
          </span>
          <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-900/80">
            {formatNumber(state.summary.detections)} detecciones
          </span>
        </div>
      </header>

      {state.loading && !state.rows.length ? (
        <div className="grid min-h-72 place-items-center p-6">
          <div className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            <LoaderCircle className="mx-auto mb-3 animate-spin" size={23} />
            Calculando {title.toLowerCase()}...
          </div>
        </div>
      ) : state.error && !state.rows.length ? (
        <div className="grid min-h-72 place-items-center p-6 text-center">
          <div>
            <AlertTriangle className="mx-auto text-red-600 dark:text-red-400" size={24} />
            <strong className="mt-3 block text-sm text-zinc-900 dark:text-zinc-100">No se pudo cargar esta sección</strong>
            <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500 dark:text-zinc-400">{state.error}</p>
            <button
              className="mt-4 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              onClick={() => void state.loadFirstPage()}
              type="button"
            >
              Reintentar
            </button>
          </div>
        </div>
      ) : !state.rows.length ? (
        <div className="grid min-h-72 place-items-center p-6 text-center">
          <div>
            <span className={`mx-auto grid size-12 place-items-center rounded-2xl ${tone.icon}`}>
              {recognized ? <ShieldCheck size={21} /> : <UserRound size={21} />}
            </span>
            <strong className="mt-3 block text-sm text-zinc-900 dark:text-zinc-100">
              Sin {title.toLowerCase()} en {formatMonth(month)}
            </strong>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Prueba otra búsqueda o selecciona un mes distinto.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {state.rows.map((row) => (
              <IdentityRow key={`${row.subject_kind}:${row.subject_key}`} row={row} accent={accent} />
            ))}
          </div>
          {state.error ? (
            <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
              {state.error}
            </p>
          ) : null}
          {state.rows.length < state.total ? (
            <button
              className={`flex min-h-12 w-full items-center justify-center gap-2 border-t border-zinc-100 bg-zinc-50 px-4 text-xs font-bold text-zinc-600 transition disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 ${tone.button}`}
              disabled={state.loadingMore}
              onClick={() => void state.loadMore()}
              type="button"
            >
              {state.loadingMore ? <LoaderCircle className="animate-spin" size={14} /> : <UsersRound size={14} />}
              {state.loadingMore
                ? "Cargando más personas..."
                : `Cargar más · ${formatNumber(state.rows.length)} de ${formatNumber(state.total)}`}
            </button>
          ) : (
            <p className="border-t border-zinc-100 bg-zinc-50 px-4 py-3 text-center text-[11px] font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
              Mostrando las {formatNumber(state.total)} personas de esta sección
            </p>
          )}
        </>
      )}
    </article>
  );
}

function IdentityRow({ row, accent }: { row: MonthlyAttendanceRow; accent: "emerald" | "violet" }) {
  const recognized = row.subject_kind === "known";
  const context = row.group_name || row.team_name || (recognized ? "Sin grupo asignado" : "Identidad local");
  const minimumDays = Number(row.expected_fee_minimum_days ?? (recognized ? 1 : 3));
  const missingDays = Math.max(0, minimumDays - Number(row.attendance_days || 0));
  const feeApplicable = row.fee_applicable !== false;
  const eligible = Boolean(row.expected_fee_eligible);
  const avatarTone =
    accent === "emerald"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
      : "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200";

  return (
    <div className="grid gap-3 p-4 transition hover:bg-zinc-50/80 dark:hover:bg-zinc-900/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-sm font-black ${avatarTone}`}>
          {initials(row.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="max-w-64 truncate text-sm text-zinc-950 dark:text-zinc-50">{row.name}</strong>
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {recognized ? personTypeLabel(row.person_type) : "Desconocido"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{context}</p>
          <p className="mt-1.5 text-[10px] text-zinc-400">
            {formatDate(row.first_date)}–{formatDate(row.last_date)}
            {" · "}
            {formatNumber(row.session_count)} sesiones
            {" · "}
            {formatNumber(row.detection_count)} detecciones
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:min-w-56">
        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-center dark:bg-zinc-900">
          <strong className="block text-lg font-black tabular-nums text-zinc-950 dark:text-zinc-50">
            {formatNumber(row.attendance_days)}
          </strong>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
            {Number(row.attendance_days) === 1 ? "Día" : "Días"}
          </span>
        </div>
        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-right dark:bg-zinc-900">
          <strong className={`block text-sm font-black tabular-nums ${eligible ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-400"}`}>
            {formatCurrency(row.expected_monthly_amount)}
          </strong>
          {!feeApplicable ? (
            <span className="mt-1 block text-[9px] font-semibold text-zinc-400">
              Sin cuota de academia
            </span>
          ) : row.payment_applicable ? (
            row.payment_registered ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={10} /> Pago registrado
              </span>
            ) : eligible ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-bold text-red-700 dark:text-red-300">
                <XCircle size={10} /> Pago pendiente
              </span>
            ) : (
              <span className="mt-1 block text-[9px] font-semibold text-zinc-400">
                Faltan {missingDays} {missingDays === 1 ? "día" : "días"}
              </span>
            )
          ) : (
            <span className="mt-1 block text-[9px] font-semibold text-zinc-400">
              {eligible ? "Cuota generada" : `Faltan ${missingDays} ${missingDays === 1 ? "día" : "días"}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageCard({
  icon,
  title,
  detail,
  tone,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  tone: "neutral" | "warning" | "error";
  action?: React.ReactNode;
}) {
  const styles = {
    neutral: "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
    error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100",
  };
  return (
    <article className={`flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center ${styles[tone]}`}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-current/10">{icon}</span>
      <div className="min-w-0 flex-1">
        <strong className="block text-sm">{title}</strong>
        <p className="mt-1 text-xs leading-5 opacity-75">{detail}</p>
      </div>
      {action}
    </article>
  );
}
