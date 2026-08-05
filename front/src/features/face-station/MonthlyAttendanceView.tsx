import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, CheckCircle2, ChevronRight, Images, Minus, Search, ShieldCheck, UserPlus, UserRound, UsersRound, XCircle } from "lucide-react";
import { stationApi, toQuery } from "./api";
import { EmptyState, FilterChip, LoadingState, MetricCard, panelClass } from "./components";
import { compactNumber, currency, currentMonth, dateLabel, dateTimeDateLabel, identityTypeLabel, monthLabel } from "./format";
import { useDebouncedValue, useInfiniteTrigger } from "./hooks";
import type { DetectionTarget, MonthlyAttendanceRow, MonthlyResponse, MonthlySummary, QuickStudentResponse, ToastMessage, UnknownAttendance } from "./types";
import { QuickStudentModal } from "./QuickStudentModal";

const MONTHLY_BATCH_SIZE = 48;
const FINANCIAL_BATCH_SIZE = 12;
type MonthlyKind = "all" | "known" | "unknown";
type QuickPersonType = "student" | "collaborator";
type RegistrationSource = Pick<UnknownAttendance, "subject_id" | "temporary_name">;

const emptySummary: MonthlySummary = { people: 0, known: 0, unknown: 0, attendance_days: 0 };

export function MonthlyAttendanceView({
  onOpenDetail,
  onNotify,
}: {
  onOpenDetail: (target: DetectionTarget) => void;
  onNotify: (text: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [kind, setKind] = useState<MonthlyKind>("all");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const [rows, setRows] = useState<MonthlyAttendanceRow[]>([]);
  const [summary, setSummary] = useState<MonthlySummary>(emptySummary);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [monthlyFee, setMonthlyFee] = useState(1000);
  const [monthlyFeeDraft, setMonthlyFeeDraft] = useState("1000");
  const [registeredMinimumAttendanceDays, setRegisteredMinimumAttendanceDays] = useState(1);
  const [unknownMinimumAttendanceDays, setUnknownMinimumAttendanceDays] = useState(3);
  const [savingMonthlyFee, setSavingMonthlyFee] = useState(false);
  const [registrationTarget, setRegistrationTarget] = useState<{
    row: RegistrationSource;
    personType: QuickPersonType;
  } | null>(null);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setRows([]);
    try {
      const payload = await stationApi<MonthlyResponse>(`/api/attendance/monthly?${toQuery({ month, q: query, kind, offset: 0, limit: MONTHLY_BATCH_SIZE })}`);
      if (id !== requestId.current) return;
      setRows(payload.items || []);
      setTotal(Number(payload.total || 0));
      setSummary(payload.summary || emptySummary);
      const configuredFee = Number(payload.revenue_policy?.monthly_fee_amount ?? 1000);
      setMonthlyFee(configuredFee);
      setMonthlyFeeDraft(String(configuredFee));
      setRegisteredMinimumAttendanceDays(Number(payload.revenue_policy?.registered_minimum_attendance_days ?? 1));
      setUnknownMinimumAttendanceDays(Number(
        payload.revenue_policy?.unknown_minimum_attendance_days
        ?? payload.revenue_policy?.minimum_attendance_days
        ?? 3,
      ));
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : "No se pudo calcular el resumen mensual.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [kind, month, query]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const hasMore = rows.length < total;
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const id = requestId.current;
    try {
      const payload = await stationApi<MonthlyResponse>(`/api/attendance/monthly?${toQuery({ month, q: query, kind, offset: rows.length, limit: MONTHLY_BATCH_SIZE })}`);
      if (id !== requestId.current) return;
      setRows((current) => [...current, ...(payload.items || [])]);
      setTotal(Number(payload.total || total));
      setSummary(payload.summary || summary);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar más personas.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [hasMore, kind, loading, month, query, rows.length, summary, total]);
  const sentinelRef = useInfiniteTrigger(() => void loadMore(), hasMore && !loading);

  async function saveMonthlyFee() {
    const amount = Number(monthlyFeeDraft);
    if (!monthlyFeeDraft.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
      onNotify("La cuota mensual debe estar entre $0 y $1,000,000.", "error");
      return;
    }
    setSavingMonthlyFee(true);
    try {
      await stationApi("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ monthly_fee_amount: amount }),
      });
      setMonthlyFee(amount);
      await loadFirstPage();
      onNotify(`Cuota mensual actualizada a ${currency(amount)}. La detección continuó activa.`);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "No se pudo actualizar la cuota mensual.", "error");
    } finally {
      setSavingMonthlyFee(false);
    }
  }

  async function createPerson(fullName: string, cropId: number) {
    if (!registrationTarget) return;
    const { row, personType } = registrationTarget;
    const personLabel = personType === "student" ? "alumno" : "colaborador";
    setCreatingPerson(true);
    try {
      const result = await stationApi<QuickStudentResponse>(
        `/api/unknowns/${encodeURIComponent(row.subject_id)}/${personType === "student" ? "students" : "collaborators"}`,
        {
          method: "POST",
          body: JSON.stringify({ full_name: fullName, crop_id: cropId }),
        },
      );
      onNotify(
        `${result.person.name} quedó registrado como ${personLabel}. `
        + "Su asistencia mensual y sus recortes ya pertenecen a esta identidad.",
      );
      setRegistrationTarget(null);
      await loadFirstPage();
    } catch (reason) {
      onNotify(
        reason instanceof Error ? reason.message : `No se pudo registrar el ${personLabel}.`,
        "error",
      );
    } finally {
      setCreatingPerson(false);
    }
  }

  const monthlyFeeValue = Number(monthlyFeeDraft);
  const monthlyFeeIsValid = Boolean(monthlyFeeDraft.trim())
    && Number.isFinite(monthlyFeeValue)
    && monthlyFeeValue >= 0
    && monthlyFeeValue <= 1_000_000;

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">Historial de asistencia</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">Resumen mensual por persona</h1>
          <p className="mt-1 text-xs text-zinc-500">Cada persona cuenta una sola vez por día, sin importar cuántas apariciones tenga.</p>
        </div>
        <label className="text-[9px] font-extrabold uppercase tracking-wider text-zinc-500">Mes
          <input className="mt-1.5 block min-h-10 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm" type="month" value={month} onChange={(event) => setMonth(event.target.value || month)} />
        </label>
      </header>

      <section className="mb-4 overflow-hidden rounded-2xl border border-emerald-800 bg-gradient-to-br from-zinc-950 via-emerald-950 to-emerald-800 text-white shadow-sm" aria-label="Ingreso mensual esperado">
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.65fr)] lg:items-center">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-emerald-200">
              <Banknote size={21} />
            </span>
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-200">Ingreso mensual esperado</p>
              <p className="mt-1 text-3xl font-black tracking-tight tabular-nums sm:text-4xl">{currency(summary.expected_revenue)}</p>
              <p className="mt-1.5 text-[11px] text-emerald-100/80">
                {compactNumber(summary.expected_payers)} identidades ya generan cuota en {monthLabel(month)}.
              </p>
              <p className="mt-1 text-[9px] text-white/55">
                Registrados desde su {registeredMinimumAttendanceDays === 1 ? "primera asistencia" : `${registeredMinimumAttendanceDays}.ª asistencia`}; desconocidos al acumular {unknownMinimumAttendanceDays} días. Incluye {compactNumber(summary.payment_missing)} alumnos con pago pendiente.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-sm">
            <label className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-100" htmlFor="monthly-fee-amount">Cuota mensual por identidad</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <span className="relative block flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-500">$</span>
                <input
                  id="monthly-fee-amount"
                  className="min-h-10 w-full rounded-lg border border-white/20 bg-white pl-7 pr-12 text-sm font-bold tabular-nums text-zinc-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/30"
                  type="number"
                  min="0"
                  max="1000000"
                  step="50"
                  value={monthlyFeeDraft}
                  onChange={(event) => setMonthlyFeeDraft(event.target.value)}
                  aria-invalid={!monthlyFeeIsValid}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-extrabold text-zinc-400">MXN</span>
              </span>
              <button
                className="min-h-10 rounded-lg bg-emerald-400 px-4 text-[10px] font-extrabold text-emerald-950 shadow-sm transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/45"
                type="button"
                disabled={savingMonthlyFee || !monthlyFeeIsValid || monthlyFeeValue === monthlyFee}
                onClick={() => void saveMonthlyFee()}
              >
                {savingMonthlyFee ? "Guardando..." : "Guardar cuota"}
              </button>
            </div>
            <p className="mt-2 text-[9px] leading-relaxed text-emerald-100/65">La cuota predeterminada es $1,000 MXN y puedes cambiarla sin detener las cámaras.</p>
          </div>
        </div>
      </section>

      <MonthlyFinancialBreakdown
        month={month}
        onOpenDetail={onOpenDetail}
      />

      <section className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3.5" aria-label="Resumen mensual">
        <MetricCard label="Personas con asistencia" value={compactNumber(summary.people)} detail="Conocidos y desconocidos" accent="emerald" />
        <MetricCard label="Personas registradas" value={compactNumber(summary.known)} detail="Identificadas en la base local" accent="blue" />
        <MetricCard label="Desconocidos" value={compactNumber(summary.unknown)} detail="Identidades locales consolidadas" accent="violet" />
        <MetricCard label="Asistencias acumuladas" value={compactNumber(summary.attendance_days)} detail="Días-persona en el mes" accent="amber" />
      </section>

      <section className={panelClass}>
        <div className="flex flex-col gap-3 border-b border-zinc-200 bg-white px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <label className="block w-full max-w-lg text-[9px] font-extrabold uppercase tracking-wider text-zinc-500">Buscar persona, desconocido, grupo o equipo
            <span className="relative mt-1.5 block"><Search className="absolute left-3 top-3 text-zinc-400" size={15} /><input className="min-h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-xs font-medium normal-case tracking-normal text-zinc-800 shadow-inner" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="Ej. Ana, Desconocido 9017 o Sub 12" type="search" /></span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={kind === "all"} onClick={() => setKind("all")}>Todos</FilterChip>
            <FilterChip active={kind === "known"} onClick={() => setKind("known")}>Registrados</FilterChip>
            <FilterChip active={kind === "unknown"} onClick={() => setKind("unknown")}>Desconocidos</FilterChip>
          </div>
        </div>
        <div className="flex min-h-11 flex-col gap-1 border-b border-zinc-100 px-4 py-2.5 text-[10px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>{rows.length ? `Mostrando ${compactNumber(rows.length)} de ${compactNumber(total)} personas en ${monthLabel(month)}. Abre “Recortes” para ver toda su evidencia.` : loading ? "Consultando asistencias locales..." : `Sin resultados en ${monthLabel(month)}.`}</p>
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700"><i className="size-1.5 rounded-full bg-emerald-500" /> Resumen calculado en esta PC</span>
        </div>

        <div className="station-scrollbar overflow-x-auto">
          {loading && !rows.length ? <LoadingState label="Calculando resumen mensual..." /> : error && !rows.length ? <EmptyState error title="No se pudo calcular el mes" detail={error} /> : (
            <table className="station-table w-full border-collapse">
              <thead><tr><th>Persona</th><th>Tipo</th><th>Grupo / equipo</th><th>Ingreso esperado</th><th>Pago del mes</th><th>Monto registrado</th><th>Último pago</th><th>Días asistidos</th><th>Sesiones</th><th>Primera fecha</th><th>Última fecha</th><th>Apariciones</th><th>Acciones</th></tr></thead>
              <tbody>
                {!rows.length ? <tr><td className="!py-14 text-center !text-zinc-500" colSpan={13}>No hay asistencias para {monthLabel(month)}{query ? " con esta búsqueda" : ""}.</td></tr> : rows.map((row) => (
                  <MonthlyRow
                    key={`${row.subject_kind}:${row.subject_key}`}
                    row={row}
                    month={month}
                    onOpen={() => onOpenDetail({ scope: "month", kind: row.subject_kind, subjectKey: row.subject_key, month })}
                    onRegisterNew={(personType) => setRegistrationTarget({
                      row: { subject_id: row.subject_key, temporary_name: row.name },
                      personType,
                    })}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
        {hasMore ? <button ref={sentinelRef} className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-zinc-100 bg-white text-[10px] font-semibold text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700" onClick={() => void loadMore()} type="button"><UsersRound size={14} /> {loading ? "Cargando más personas..." : `Cargar más · ${compactNumber(rows.length)} de ${compactNumber(total)}`}</button> : null}
      </section>
      {registrationTarget ? (
        <QuickStudentModal
          row={registrationTarget.row}
          personType={registrationTarget.personType}
          saving={creatingPerson}
          onClose={() => !creatingPerson && setRegistrationTarget(null)}
          onConfirm={(fullName, cropId) => void createPerson(fullName, cropId)}
        />
      ) : null}
    </div>
  );
}

function MonthlyFinancialBreakdown({
  month,
  onOpenDetail,
}: {
  month: string;
  onOpenDetail: (target: DetectionTarget) => void;
}) {
  return (
    <section className="mb-4" aria-labelledby="monthly-financial-breakdown-title">
      <div className="mb-2.5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">Desglose financiero</p>
          <h2 id="monthly-financial-breakdown-title" className="mt-0.5 text-base font-bold tracking-tight text-zinc-900">Ingreso por tipo de identidad</h2>
        </div>
        <p className="text-[9px] text-zinc-500">“Veces que asistió” cuenta días distintos dentro del mes.</p>
      </div>
      <div className="grid gap-3.5 xl:grid-cols-2">
        <MonthlyFinancialSection
          month={month}
          kind="known"
          title="Reconocidos"
          detail="Personas identificadas en la base local"
          accent="emerald"
          onOpenDetail={onOpenDetail}
        />
        <MonthlyFinancialSection
          month={month}
          kind="unknown"
          title="No reconocidos"
          detail="Identidades desconocidas agrupadas"
          accent="violet"
          onOpenDetail={onOpenDetail}
        />
      </div>
    </section>
  );
}

function MonthlyFinancialSection({
  month,
  kind,
  title,
  detail,
  accent,
  onOpenDetail,
}: {
  month: string;
  kind: "known" | "unknown";
  title: string;
  detail: string;
  accent: "emerald" | "violet";
  onOpenDetail: (target: DetectionTarget) => void;
}) {
  const [rows, setRows] = useState<MonthlyAttendanceRow[]>([]);
  const [summary, setSummary] = useState<MonthlySummary>(emptySummary);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setRows([]);
    try {
      const payload = await stationApi<MonthlyResponse>(`/api/attendance/monthly?${toQuery({
        month,
        q: "",
        kind,
        revenue_only: 1,
        offset: 0,
        limit: FINANCIAL_BATCH_SIZE,
      })}`);
      if (id !== requestId.current) return;
      setRows(payload.items || []);
      setSummary(payload.summary || emptySummary);
      setTotal(Number(payload.total || 0));
    } catch (reason) {
      if (id === requestId.current) {
        setError(reason instanceof Error ? reason.message : `No se pudo cargar la sección ${title.toLowerCase()}.`);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [kind, month, title]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const hasMore = rows.length < total;
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const id = requestId.current;
    try {
      const payload = await stationApi<MonthlyResponse>(`/api/attendance/monthly?${toQuery({
        month,
        q: "",
        kind,
        revenue_only: 1,
        offset: rows.length,
        limit: FINANCIAL_BATCH_SIZE,
      })}`);
      if (id !== requestId.current) return;
      setRows((current) => [...current, ...(payload.items || [])]);
      setTotal(Number(payload.total || total));
    } catch (reason) {
      if (id === requestId.current) {
        setError(reason instanceof Error ? reason.message : "No se pudieron cargar más personas.");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [hasMore, kind, loading, month, rows.length, total]);
  const sentinelRef = useInfiniteTrigger(() => void loadMore(), hasMore && !loading);

  const accentClasses = accent === "emerald"
    ? {
        border: "border-emerald-200",
        icon: "bg-emerald-100 text-emerald-800",
        total: "text-emerald-800",
        header: "from-emerald-50 to-white",
      }
    : {
        border: "border-violet-200",
        icon: "bg-violet-100 text-violet-800",
        total: "text-violet-800",
        header: "from-violet-50 to-white",
      };

  return (
    <article className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${accentClasses.border}`}>
      <header className={`flex items-center justify-between gap-3 border-b border-zinc-100 bg-gradient-to-r px-4 py-3.5 ${accentClasses.header}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${accentClasses.icon}`}>
            {kind === "known" ? <ShieldCheck size={18} /> : <UserRound size={18} />}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-zinc-900">{title}</h3>
            <p className="truncate text-[9px] text-zinc-500">{compactNumber(summary.people)} personas · {detail}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[8px] font-extrabold uppercase tracking-wider text-zinc-400">Total de la sección</p>
          <strong className={`block text-xl font-black tabular-nums ${accentClasses.total}`}>{currency(summary.expected_revenue)}</strong>
        </div>
      </header>

      {loading && !rows.length ? (
        <LoadingState label={`Calculando ${title.toLowerCase()}...`} />
      ) : error && !rows.length ? (
        <EmptyState error title={`No se pudieron cargar ${title.toLowerCase()}`} detail={error} />
      ) : (
        <div className="station-scrollbar max-h-[420px] overflow-auto">
          <table className="station-table w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgb(228_228_231)]">
              <tr><th>Persona</th><th>Veces que asistió</th><th>Ingreso esperado</th><th aria-label="Acciones" /></tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr><td className="!py-12 text-center !text-zinc-500" colSpan={4}>No hay personas en esta sección durante {monthLabel(month)}.</td></tr>
              ) : rows.map((row) => (
                <MonthlyFinancialRow
                  key={`${kind}:${row.subject_key}`}
                  row={row}
                  month={month}
                  onOpen={() => onOpenDetail({ scope: "month", kind: row.subject_kind, subjectKey: row.subject_key, month })}
                />
              ))}
            </tbody>
          </table>
          {hasMore ? (
            <button
              ref={sentinelRef}
              className="flex min-h-11 w-full items-center justify-center gap-2 border-t border-zinc-100 bg-zinc-50 text-[9px] font-bold text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-800"
              onClick={() => void loadMore()}
              type="button"
            >
              <UsersRound size={13} /> {loading ? "Cargando..." : `Cargar más · ${compactNumber(rows.length)} de ${compactNumber(total)}`}
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}

function MonthlyFinancialRow({
  row,
  month,
  onOpen,
}: {
  row: MonthlyAttendanceRow;
  month: string;
  onOpen: () => void;
}) {
  const known = row.subject_kind === "known";
  const linked = !known && Boolean(row.linked_person_key);
  const imageKind = known || linked ? "person" : "unknown";
  const identifier = linked ? row.linked_person_key || row.subject_key : row.subject_key;
  const fallback = known ? `/api/images/presence/${encodeURIComponent(row.subject_key)}` : `/api/images/unknown/${encodeURIComponent(row.subject_key)}`;
  const [src, setSrc] = useState(`/api/images/${imageKind}/${encodeURIComponent(identifier)}`);
  const eligible = Boolean(row.expected_fee_eligible);
  const expectedFeeApplicable = row.expected_fee_applicable !== false
    && Number(row.expected_fee_applicable ?? 1) !== 0;
  const requiredDays = Number(row.expected_fee_minimum_days ?? (known || linked ? 1 : 3));
  const missingDays = Math.max(0, requiredDays - Number(row.attendance_days || 0));
  const paymentApplicable = Boolean(row.payment_applicable);
  const paymentRegistered = paymentApplicable && Boolean(row.payment_registered);

  return (
    <tr>
      <td>
        <div className="flex min-w-48 items-center gap-2">
          <img
            className="size-9 rounded-lg border border-zinc-200 bg-zinc-100 object-cover"
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              if (src !== fallback) setSrc(fallback);
              else event.currentTarget.style.visibility = "hidden";
            }}
          />
          <div className="min-w-0">
            <strong className="block max-w-52 truncate text-[10px] text-zinc-800">{row.name}</strong>
            <small className="text-[8px] text-zinc-400">{known || linked ? identityTypeLabel(row.person_type) : "Identidad local"}</small>
          </div>
        </div>
      </td>
      <td>
        <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <strong className="text-sm tabular-nums text-zinc-800">{compactNumber(row.attendance_days)}</strong>
          <small className="text-[8px] text-zinc-400">{Number(row.attendance_days) === 1 ? "día" : "días"}</small>
        </span>
      </td>
      <td>
        <strong className={`block whitespace-nowrap text-[11px] tabular-nums ${eligible ? "text-emerald-800" : "text-zinc-400"}`}>
          {currency(row.expected_monthly_amount)}
        </strong>
        <small className={`text-[8px] ${eligible ? "text-emerald-600" : "text-zinc-400"}`}>
          {!expectedFeeApplicable ? "No aplica" : paymentRegistered ? "Pago registrado" : paymentApplicable && eligible ? "Pago pendiente" : eligible ? "Cuota generada" : `Faltan ${missingDays} ${missingDays === 1 ? "día" : "días"}`}
        </small>
      </td>
      <td>
        <button
          className="grid size-8 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
          onClick={onOpen}
          type="button"
          aria-label={`Ver recortes de ${row.name} en ${monthLabel(month)}`}
        >
          <ChevronRight size={14} />
        </button>
      </td>
    </tr>
  );
}

function MonthlyRow({
  row,
  month,
  onOpen,
  onRegisterNew,
}: {
  row: MonthlyAttendanceRow;
  month: string;
  onOpen: () => void;
  onRegisterNew: (personType: QuickPersonType) => void;
}) {
  const known = row.subject_kind === "known";
  const linked = !known && Boolean(row.linked_person_key);
  const canRegister = !known && !linked && ["candidate", "consolidated"].includes(row.status || "");
  const imageKind = known || linked ? "person" : "unknown";
  const identifier = linked ? row.linked_person_key || row.subject_key : row.subject_key;
  const fallback = known ? `/api/images/presence/${encodeURIComponent(row.subject_key)}` : `/api/images/unknown/${encodeURIComponent(row.subject_key)}`;
  const [src, setSrc] = useState(`/api/images/${imageKind}/${encodeURIComponent(identifier)}`);
  const kindLabel = known ? "Registrado" : linked ? "Vinculado" : "Desconocido";
  const kindTone = known ? "bg-emerald-50 text-emerald-700" : linked ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700";
  const context = row.group_name || row.team_name || (known ? "Sin grupo asignado" : "Identidad local");
  const identityLabel = known ? identityTypeLabel(row.person_type) : linked ? "Identidad confirmada" : "Rostro consolidado";
  const paymentApplicable = Boolean(row.payment_applicable);
  const paymentRegistered = paymentApplicable && Boolean(row.payment_registered);
  const expectedFeeApplicable = row.expected_fee_applicable !== false
    && Number(row.expected_fee_applicable ?? 1) !== 0;
  const expectedFeeEligible = Boolean(row.expected_fee_eligible);
  const minimumAttendanceDays = Number(row.expected_fee_minimum_days ?? (known || linked ? 1 : 3));
  const missingAttendanceDays = Math.max(0, minimumAttendanceDays - Number(row.attendance_days || 0));
  return (
    <tr>
      <td><div className="flex min-w-56 items-center gap-2.5"><img className="size-11 rounded-xl border border-zinc-200 bg-zinc-100 object-cover" src={src} alt="" loading="lazy" decoding="async" onError={(event) => { if (src !== fallback) setSrc(fallback); else event.currentTarget.style.visibility = "hidden"; }} /><div className="min-w-0"><strong className="block max-w-48 truncate text-[11px] text-zinc-800">{row.name}</strong><small className="text-[9px] text-zinc-400">{identityLabel}</small></div></div></td>
      <td><span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[8px] font-extrabold ${kindTone}`}>{known ? <ShieldCheck size={10} /> : <UserRound size={10} />}{kindLabel}</span></td>
      <td>{context}</td>
      <td>
        {!expectedFeeApplicable ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-zinc-100 px-2 py-1 text-[9px] font-semibold text-zinc-500">
            <Minus size={11} /> No aplica
          </span>
        ) : expectedFeeEligible ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-extrabold text-emerald-800">
            <Banknote size={11} /> {currency(row.expected_monthly_amount)}
          </span>
        ) : (
          <span className="whitespace-nowrap text-[9px] font-semibold text-zinc-400">
            Faltan {missingAttendanceDays} {missingAttendanceDays === 1 ? "día" : "días"}
          </span>
        )}
      </td>
      <td>
        {paymentRegistered ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-1 text-[8px] font-extrabold text-emerald-700">
            <CheckCircle2 size={10} /> Registrado
            {Number(row.payment_count || 0) > 1 ? ` · ${compactNumber(row.payment_count)}` : ""}
          </span>
        ) : paymentApplicable ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-red-50 px-2 py-1 text-[8px] font-extrabold text-red-700">
            <XCircle size={10} /> Sin registro
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-zinc-100 px-2 py-1 text-[8px] font-bold text-zinc-500">
            <Minus size={10} /> No aplica
          </span>
        )}
      </td>
      <td>
        {paymentRegistered ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-zinc-800">
            <Banknote size={11} className="text-emerald-700" /> {currency(row.payment_amount)}
          </span>
        ) : "—"}
      </td>
      <td>{paymentRegistered ? dateTimeDateLabel(row.last_paid_at) : "—"}</td>
      <td><span className="inline-flex items-baseline gap-1"><strong className="text-base tabular-nums text-emerald-800">{compactNumber(row.attendance_days)}</strong><small className="text-[8px] text-zinc-400">días</small></span></td>
      <td>{compactNumber(row.session_count)}</td><td>{dateLabel(row.first_date)}</td><td>{dateLabel(row.last_date)}</td><td>{compactNumber(row.detection_count)}</td>
      <td>
        <div className="flex min-w-max items-center gap-1.5">
          <button
            className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[9px] font-bold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100"
            onClick={onOpen}
            type="button"
            aria-label={`Ver todos los recortes de ${row.name} en ${monthLabel(month)}`}
          >
            <Images size={12} /> Recortes <ChevronRight size={11} />
          </button>
          {canRegister ? (
            <>
              <button
                className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 text-[9px] font-bold text-zinc-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => onRegisterNew("student")}
                type="button"
                aria-label={`Registrar ${row.name} como nuevo alumno`}
              >
                <UserPlus size={12} /> Nuevo alumno
              </button>
              <button
                className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 text-[9px] font-bold text-zinc-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
                onClick={() => onRegisterNew("collaborator")}
                type="button"
                aria-label={`Registrar ${row.name} como nuevo colaborador`}
              >
                <UserPlus size={12} /> Nuevo colaborador
              </button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
