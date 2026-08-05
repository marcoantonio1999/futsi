import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CalendarCheck2, Check, CheckSquare2, ChevronRight, EyeOff, GitMerge, Link2, LoaderCircle, Moon, Search, Square, UserPlus, X } from "lucide-react";
import { stationApi } from "./api";
import { Button, EmptyState, LoadingState, MetricCard, SectionHeading, panelClass } from "./components";
import { compactNumber, localTime, normalizeSearch, todayLocal } from "./format";
import { useInfiniteTrigger } from "./hooks";
import type { DailyDashboard, DetectionTarget, PersonOption, QuickStudentResponse, ToastMessage, UnknownAttendance, UnknownIgnoreResponse, UnknownMergeResponse } from "./types";
import { IgnoredUnknownsModal } from "./IgnoredUnknownsModal";
import { QuickStudentModal } from "./QuickStudentModal";
import { UnknownIgnoreModal } from "./UnknownIgnoreModal";
import { UnknownMergeModal } from "./UnknownMergeModal";

const UNKNOWN_BATCH_SIZE = 28;
type SelectionMode = "merge" | "ignore" | null;
type QuickPersonType = "student" | "collaborator";
type CropRejectionResponse = {
  status: "rejected" | "already_rejected";
  attendance_removed: boolean;
  remaining_crops: number;
};

export function DailyAttendanceView({ onOpenDetail, onNotify }: { onOpenDetail: (target: DetectionTarget) => void; onNotify: (text: string, tone?: ToastMessage["tone"]) => void }) {
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [dashboard, setDashboard] = useState<DailyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visibleUnknowns, setVisibleUnknowns] = useState(UNKNOWN_BATCH_SIZE);
  const [unknownQuery, setUnknownQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(null);
  const [selectedUnknownIds, setSelectedUnknownIds] = useState<string[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeReviewOpen, setMergeReviewOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [ignoreReviewOpen, setIgnoreReviewOpen] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [ignoredListOpen, setIgnoredListOpen] = useState(false);
  const [registrationTarget, setRegistrationTarget] = useState<{
    row: UnknownAttendance;
    personType: QuickPersonType;
  } | null>(null);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<UnknownAttendance | null>(null);
  const [rejectingCrop, setRejectingCrop] = useState(false);
  const [rejectError, setRejectError] = useState("");

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setDashboard(await stationApi<DailyDashboard>(`/api/dashboard?date=${encodeURIComponent(selectedDate)}`));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la asistencia local.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    setVisibleUnknowns(UNKNOWN_BATCH_SIZE);
    let cancelled = false;
    let timer: number | undefined;
    const poll = async (silent: boolean) => {
      await loadDashboard(silent);
      if (!cancelled && selectedDate === todayLocal()) {
        timer = window.setTimeout(() => void poll(true), 4000);
      }
    };
    void poll(false);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadDashboard, selectedDate]);

  useEffect(() => {
    setSelectionMode(null);
    setSelectedUnknownIds([]);
    setMergeReviewOpen(false);
    setIgnoreReviewOpen(false);
    setUnknownQuery("");
    setRegistrationTarget(null);
    setRejectTarget(null);
    setRejectError("");
  }, [selectedDate]);

  useEffect(() => {
    setVisibleUnknowns(UNKNOWN_BATCH_SIZE);
  }, [unknownQuery]);

  const known = dashboard?.known || [];
  const unknown = dashboard?.unknown || [];
  const filteredUnknowns = useMemo(() => {
    const normalized = normalizeSearch(unknownQuery);
    if (!normalized) return unknown;
    return unknown.filter((row) => normalizeSearch(row.temporary_name).includes(normalized));
  }, [unknown, unknownQuery]);
  const selectedUnknowns = useMemo(
    () => selectedUnknownIds
      .map((subjectId) => unknown.find((row) => row.subject_id === subjectId))
      .filter((row): row is UnknownAttendance => Boolean(row)),
    [selectedUnknownIds, unknown],
  );
  const unknownHits = unknown.reduce((sum, row) => sum + Number(row.detection_count || 0), 0);
  const hasMore = visibleUnknowns < filteredUnknowns.length;
  const sentinelRef = useInfiniteTrigger(
    () => setVisibleUnknowns((count) => Math.min(count + UNKNOWN_BATCH_SIZE, filteredUnknowns.length)),
    hasMore,
  );

  async function linkUnknown(subjectId: string, personKey: string) {
    try {
      await stationApi(`/api/unknowns/${encodeURIComponent(subjectId)}/link`, { method: "POST", body: JSON.stringify({ person_key: personKey }) });
      onNotify("Identidad vinculada. Las apariciones quedaron en la cola de sincronización.");
      await loadDashboard(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo vincular la identidad.";
      onNotify(message, "error");
      throw reason;
    }
  }

  function toggleSelectionMode(mode: Exclude<SelectionMode, null>) {
    setSelectionMode((current) => current === mode ? null : mode);
    setSelectedUnknownIds([]);
    setMergeReviewOpen(false);
    setIgnoreReviewOpen(false);
  }

  function toggleUnknownSelection(subjectId: string) {
    setSelectedUnknownIds((current) => (
      current.includes(subjectId)
        ? current.filter((item) => item !== subjectId)
        : [...current, subjectId]
    ));
  }

  function reviewSelection() {
    if (selectionMode === "ignore") {
      if (!selectedUnknowns.length) return;
      setIgnoreReviewOpen(true);
      return;
    }
    if (selectionMode !== "merge" || selectedUnknowns.length < 2) return;
    const recommended = [...selectedUnknowns].sort((first, second) => (
      Number(second.best_quality || 0) - Number(first.best_quality || 0)
      || Number(second.detection_count || 0) - Number(first.detection_count || 0)
    ))[0];
    setMergeTargetId(recommended.subject_id);
    setMergeReviewOpen(true);
  }

  async function confirmMerge() {
    const sourceSubjectIds = selectedUnknownIds.filter((subjectId) => subjectId !== mergeTargetId);
    if (!mergeTargetId || !sourceSubjectIds.length) return;
    setMerging(true);
    try {
      const result = await stationApi<UnknownMergeResponse>("/api/unknowns/merge", {
        method: "POST",
        body: JSON.stringify({
          target_subject_id: mergeTargetId,
          source_subject_ids: sourceSubjectIds,
        }),
      });
      onNotify(
        `${result.merged_names.length + 1} grupos unidos como ${result.target.temporary_name}. `
        + `${result.crops_moved} recortes históricos fueron reasignados.`,
      );
      setMergeReviewOpen(false);
      setSelectionMode(null);
      setSelectedUnknownIds([]);
      setUnknownQuery("");
      await loadDashboard(true);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "No se pudieron unir los grupos.", "error");
    } finally {
      setMerging(false);
    }
  }

  async function setUnknownsIgnored(rows: UnknownAttendance[], ignored: boolean) {
    if (!rows.length) return;
    const subjectIds = rows.map((row) => row.subject_id);
    if (ignored) setIgnoring(true);
    try {
      const result = await stationApi<UnknownIgnoreResponse>("/api/unknowns/ignore", {
        method: "POST",
        body: JSON.stringify({ subject_ids: subjectIds, ignored }),
      });
      onNotify(
        ignored
          ? `${result.count} ${result.count === 1 ? "persona quedó excluida" : "personas quedaron excluidas"} de la asistencia. FaceGuard seguirá descartando sus apariciones.`
          : `${rows[0].temporary_name} volvió a la lista y recuperó su historial.`,
      );
      if (ignored) {
        setIgnoreReviewOpen(false);
        setSelectionMode(null);
        setSelectedUnknownIds([]);
        setUnknownQuery("");
      }
      await loadDashboard(true);
    } catch (reason) {
      onNotify(
        reason instanceof Error ? reason.message : "No se pudo actualizar la exclusión.",
        "error",
      );
      throw reason;
    } finally {
      if (ignored) setIgnoring(false);
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
        + "Su asistencia y sus recortes ya pertenecen a esta identidad.",
      );
      setRegistrationTarget(null);
      await loadDashboard(true);
    } catch (reason) {
      onNotify(
        reason instanceof Error ? reason.message : `No se pudo registrar el ${personLabel}.`,
        "error",
      );
    } finally {
      setCreatingPerson(false);
    }
  }

  async function rejectVisibleCrop() {
    const cropId = Number(rejectTarget?.best_crop_id || 0);
    if (!rejectTarget || cropId <= 0 || rejectingCrop) return;
    setRejectingCrop(true);
    setRejectError("");
    try {
      const result = await stationApi<CropRejectionResponse>(
        `/api/crops/${cropId}/reject`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: "Descartado manualmente desde la asistencia del día",
          }),
        },
      );
      onNotify(
        result.attendance_removed
          ? `${rejectTarget.temporary_name} ya no cuenta como asistencia sin evidencia válida.`
          : "Recorte descartado. La asistencia se recalculó con las evidencias válidas restantes.",
      );
      setRejectTarget(null);
      await loadDashboard(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo descartar el recorte.";
      setRejectError(message);
      onNotify(message, "error");
    } finally {
      setRejectingCrop(false);
    }
  }

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">Consolidado diario</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">Asistencia y desconocidos</h1>
          <p className="mt-1 text-xs text-zinc-500">Información local disponible incluso cuando falle internet.</p>
        </div>
        <label className="text-[9px] font-extrabold uppercase tracking-wider text-zinc-500">Fecha
          <input className="mt-1.5 block min-h-10 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
      </header>

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-violet-950">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-700 text-white"><Moon size={15} /></span>
        <div>
          <strong className="block text-xs">Asistencia consolidada durante la noche</strong>
          <p className="mt-0.5 text-[10px] leading-4 text-violet-800">
            FaceGuard conserva todos los recortes durante 7 días para auditoría. Al terminar el lote nocturno elige hasta 30 evidencias por persona y día, distribuidas por calidad, cámara y horario; la asistencia y el conteo completo permanecen.
          </p>
        </div>
      </div>

      <section className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3.5">
        <MetricCard label="Personas registradas" value={compactNumber(known.length)} detail="Una marca por persona y día o sesión" accent="emerald" />
        <MetricCard label="Desconocidos" value={compactNumber(unknown.length)} detail={`${compactNumber(unknownHits)} apariciones`} accent="violet" />
        <MetricCard label="Pendientes de revisión" value={compactNumber(unknown.filter((row) => row.status !== "linked").length)} detail="Se conservan solo en local" accent="blue" />
        <MetricCard label="Cola offline" value={compactNumber(dashboard?.pending_sync)} detail="Reintento automático" accent="amber" />
      </section>

      {error ? <div className={`${panelClass} mb-4`}><EmptyState error title="No se pudo consultar el día" detail={error} action={<Button onClick={() => void loadDashboard()}>Reintentar</Button>} /></div> : null}

      <section className={`${panelClass} mb-6`}>
        <SectionHeading title="Personas identificadas" description="Foto de referencia, primera aparición y detecciones acumuladas." action={<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700"><CalendarCheck2 size={13} /> {compactNumber(known.length)} presentes</span>} />
        <div className="station-scrollbar overflow-x-auto">
          {loading && !dashboard ? <LoadingState label="Preparando asistencia del día..." /> : (
            <table className="station-table w-full border-collapse">
              <thead><tr><th>Persona</th><th>Grupo / equipo</th><th>Sesión</th><th>Primera vez</th><th>Última vez</th><th>Detecciones</th><th>Estado</th></tr></thead>
              <tbody>
                {!known.length ? <tr><td className="!py-12 text-center !text-zinc-500" colSpan={7}>Sin asistencias para esta fecha.</td></tr> : known.map((row) => {
                  const grouping = row.group_name || row.team_name || "Sin grupo";
                  const hasSession = Number(row.session_id) !== -1;
                  const isCollaborator = row.person_type === "collaborator";
                  const synced = Number(row.synced) === 1 && (hasSession || isCollaborator);
                  const syncLabel = isCollaborator
                    ? synced ? "Sincronizado" : "En cola"
                    : !hasSession ? "Sin sesión" : synced ? "Sincronizado" : "En cola";
                  const personTypeLabel = row.person_type === "player"
                    ? "Jugador adulto"
                    : isCollaborator ? "Colaborador" : "Alumno";
                  return (
                    <tr key={`${row.person_key}:${row.session_id}`}>
                      <td><div className="flex min-w-52 items-center gap-2.5"><FallbackImage primary={`/api/images/person/${encodeURIComponent(row.person_key)}`} fallback={`/api/images/presence/${encodeURIComponent(row.person_key)}`} alt="" /><div><strong className="block text-[11px] text-zinc-800">{row.name}</strong><small className="text-[9px] text-zinc-400">{personTypeLabel}</small></div></div></td>
                      <td>{grouping}</td><td>{row.session_label || "—"}</td><td>{localTime(row.first_seen_at)}</td><td>{localTime(row.last_seen_at)}</td><td>{compactNumber(row.detection_count)}</td>
                      <td><span className={`inline-flex rounded-md px-2 py-1 text-[8px] font-extrabold ${synced ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{syncLabel}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Rostros desconocidos</h2>
            <p className="mt-1 text-xs text-zinc-500">Revisa identidades, une duplicados o excluye personas que no deben pasar lista.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <label className="relative block min-w-0 sm:w-64">
              <Search className="absolute left-3 top-2.5 text-zinc-400" size={14} />
              <input
                className="min-h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-[10px] font-medium shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                onChange={(event) => setUnknownQuery(event.target.value)}
                placeholder="Buscar Desconocido 3187..."
                type="search"
                value={unknownQuery}
              />
            </label>
            <Button
              onClick={() => toggleSelectionMode("merge")}
              tone={selectionMode === "merge" ? "danger" : "secondary"}
              type="button"
            >
              <GitMerge size={13} /> {selectionMode === "merge" ? "Salir de unión" : "Unir duplicados"}
            </Button>
            <Button
              onClick={() => toggleSelectionMode("ignore")}
              tone={selectionMode === "ignore" ? "danger" : "secondary"}
              type="button"
            >
              <EyeOff size={13} /> {selectionMode === "ignore" ? "Salir de exclusión" : "Excluir de lista"}
            </Button>
            <Button onClick={() => setIgnoredListOpen(true)} type="button">
              Ver excluidos
            </Button>
          </div>
        </div>

        {selectionMode ? (
          <div className={`mb-3 flex flex-col gap-3 rounded-xl border px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
            selectionMode === "merge"
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }`}>
            <div className="flex items-start gap-2.5">
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg text-white ${
                selectionMode === "merge" ? "bg-emerald-700" : "bg-amber-600"
              }`}>
                {selectionMode === "merge" ? <GitMerge size={15} /> : <EyeOff size={15} />}
              </span>
              <div>
                <strong className={`block text-xs ${selectionMode === "merge" ? "text-emerald-950" : "text-amber-950"}`}>
                  {selectedUnknownIds.length
                    ? `${selectedUnknownIds.length} ${selectionMode === "merge" ? "grupos" : "personas"} seleccionados`
                    : selectionMode === "merge"
                      ? "Selecciona los grupos de la misma persona"
                      : "Selecciona a quienes no deben pasar lista"}
                </strong>
                <p className={`mt-0.5 text-[10px] leading-4 ${selectionMode === "merge" ? "text-emerald-800" : "text-amber-800"}`}>
                  {selectionMode === "merge"
                    ? "Puedes buscar un número, seleccionarlo y continuar buscando sin perder la selección."
                    : "Seguirán comparándose para descartarlas automáticamente, sin asistencia ni nuevas tarjetas."}
                </p>
              </div>
            </div>
            <Button
              className="shrink-0"
              disabled={selectedUnknownIds.length < (selectionMode === "merge" ? 2 : 1)}
              onClick={reviewSelection}
              tone="primary"
              type="button"
            >
              {selectionMode === "merge" ? "Revisar unión" : "Revisar exclusión"} ({selectedUnknownIds.length})
            </Button>
          </div>
        ) : null}

        <p className="mb-3 text-right text-[10px] font-semibold text-emerald-700">
          Mostrando {compactNumber(Math.min(visibleUnknowns, filteredUnknowns.length))} de{" "}
          {compactNumber(filteredUnknowns.length)} personas agrupadas
        </p>

        {!unknown.length && !loading ? <div className={panelClass}><EmptyState title="Sin desconocidos para esta fecha" detail="Cuando aparezca un rostro no reconocido se mostrará aquí." /></div> : !filteredUnknowns.length ? (
          <div className={panelClass}>
            <EmptyState
              title="No encontramos ese desconocido"
              detail="Revisa el número escrito o limpia la búsqueda para ver todos los grupos."
              action={<Button onClick={() => setUnknownQuery("")}>Limpiar búsqueda</Button>}
            />
          </div>
        ) : (
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredUnknowns.slice(0, visibleUnknowns).map((row) => (
              <UnknownCard
                key={row.subject_id}
                row={row}
                people={dashboard?.people || []}
                date={selectedDate}
                selectionMode={selectionMode}
                selectedForAction={selectedUnknownIds.includes(row.subject_id)}
                onToggleSelection={() => toggleUnknownSelection(row.subject_id)}
                onOpenDetail={onOpenDetail}
                onLink={linkUnknown}
                onRegisterNew={(personType) => setRegistrationTarget({ row, personType })}
                onReject={() => {
                  setRejectError("");
                  setRejectTarget(row);
                }}
              />
            ))}
            {hasMore ? <button ref={sentinelRef} className="col-span-full min-h-12 rounded-lg border border-dashed border-zinc-300 bg-white text-[10px] font-semibold text-zinc-500 hover:border-emerald-300 hover:text-emerald-700" onClick={() => setVisibleUnknowns((count) => Math.min(count + UNKNOWN_BATCH_SIZE, filteredUnknowns.length))} type="button">Desplázate para cargar más rostros</button> : null}
          </div>
        )}
      </section>

      {mergeReviewOpen ? (
        <UnknownMergeModal
          rows={selectedUnknowns}
          targetId={mergeTargetId}
          saving={merging}
          onTargetChange={setMergeTargetId}
          onClose={() => !merging && setMergeReviewOpen(false)}
          onConfirm={() => void confirmMerge()}
        />
      ) : null}
      {ignoreReviewOpen ? (
        <UnknownIgnoreModal
          rows={selectedUnknowns}
          saving={ignoring}
          onClose={() => !ignoring && setIgnoreReviewOpen(false)}
          onConfirm={() => void setUnknownsIgnored(selectedUnknowns, true)}
        />
      ) : null}
      {ignoredListOpen ? (
        <IgnoredUnknownsModal
          onClose={() => setIgnoredListOpen(false)}
          onRestore={(row) => setUnknownsIgnored([row], false)}
        />
      ) : null}
      {registrationTarget ? (
        <QuickStudentModal
          row={registrationTarget.row}
          personType={registrationTarget.personType}
          saving={creatingPerson}
          onClose={() => !creatingPerson && setRegistrationTarget(null)}
          onConfirm={(fullName, cropId) => void createPerson(fullName, cropId)}
        />
      ) : null}
      {rejectTarget && rejectTarget.best_crop_id ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/55 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !rejectingCrop) {
              setRejectTarget(null);
              setRejectError("");
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="daily-reject-title"
            aria-modal="true"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
            data-testid="daily-reject-dialog"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-red-600">Revisión manual</p>
                <h2 id="daily-reject-title" className="mt-1 text-base font-extrabold tracking-tight text-zinc-900">
                  ¿Descartar este recorte?
                </h2>
                <p className="mt-1 text-[11px] text-zinc-500">{rejectTarget.temporary_name}</p>
              </div>
              <button
                aria-label="Cerrar"
                className="grid size-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                disabled={rejectingCrop}
                onClick={() => {
                  setRejectTarget(null);
                  setRejectError("");
                }}
                type="button"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-[112px_minmax(0,1fr)]">
              <img
                alt={`Recorte de ${rejectTarget.temporary_name} que se descartará`}
                className="h-32 w-28 rounded-xl border border-zinc-200 bg-zinc-100 object-cover"
                src={`/api/crops/${rejectTarget.best_crop_id}/image`}
              />
              <div className="self-center">
                <strong className="block text-sm text-zinc-900">Este recorte dejará de ser evidencia.</strong>
                <p className="mt-2 text-[11px] leading-5 text-zinc-500">
                  No se borrará el archivo de auditoría. FaceGuard recalculará la asistencia y,
                  si no queda evidencia facial válida, la retirará de la lista.
                </p>
              </div>
            </div>
            {rejectError ? (
              <p className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">
                {rejectError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-4">
              <Button
                disabled={rejectingCrop}
                onClick={() => {
                  setRejectTarget(null);
                  setRejectError("");
                }}
                type="button"
              >
                Cancelar
              </Button>
              <Button
                data-testid="confirm-daily-reject"
                disabled={rejectingCrop}
                onClick={() => void rejectVisibleCrop()}
                tone="danger"
                type="button"
              >
                {rejectingCrop ? <LoaderCircle className="animate-spin" size={13} /> : <Ban size={13} />}
                {rejectingCrop ? "Descartando..." : "Sí, descartar"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function FallbackImage({ primary, fallback, alt }: { primary: string; fallback: string; alt: string }) {
  const [src, setSrc] = useState(primary);
  return <img className="size-12 rounded-xl border border-zinc-200 bg-zinc-100 object-cover" src={src} alt={alt} onError={() => src !== fallback && setSrc(fallback)} />;
}

function UnknownCard({
  row,
  people,
  date,
  selectionMode,
  selectedForAction,
  onToggleSelection,
  onOpenDetail,
  onLink,
  onRegisterNew,
  onReject,
}: {
  row: UnknownAttendance;
  people: PersonOption[];
  date: string;
  selectionMode: SelectionMode;
  selectedForAction: boolean;
  onToggleSelection: () => void;
  onOpenDetail: (target: DetectionTarget) => void;
  onLink: (subjectId: string, personKey: string) => Promise<void>;
  onRegisterNew: (personType: QuickPersonType) => void;
  onReject: () => void;
}) {
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PersonOption | null>(null);
  const [saving, setSaving] = useState(false);
  const linked = row.status === "linked";
  const statusLabel = linked ? "Vinculado" : row.status === "consolidated" ? "Listo para revisar" : "Candidato";
  useEffect(() => {
    if (selectionMode) setLinking(false);
  }, [selectionMode]);
  const matches = useMemo(() => {
    const normalized = normalizeSearch(query);
    if (normalized.length < 2) return [];
    return people.filter((person) => normalizeSearch([person.name, person.group_name, person.team_name].filter(Boolean).join(" ")).includes(normalized)).slice(0, 8);
  }, [people, query]);

  async function confirm() {
    if (!selected) return;
    setSaving(true);
    try {
      await onLink(row.subject_id, selected.person_key);
      setLinking(false);
    } catch {
      // The parent already reports the API error and leaves the form available for retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`${panelClass} grid min-h-[132px] grid-cols-[88px_minmax(0,1fr)] transition hover:-translate-y-px hover:shadow-lg ${
      selectedForAction
        ? selectionMode === "ignore"
          ? "!border-amber-400 ring-2 ring-amber-100"
          : "!border-emerald-400 ring-2 ring-emerald-100"
        : ""
    }`}>
      <img
        className="h-full min-h-[132px] w-[88px] bg-zinc-100 object-cover"
        src={row.best_crop_id
          ? `/api/crops/${row.best_crop_id}/image`
          : `/api/images/unknown/${encodeURIComponent(row.subject_id)}?v=${encodeURIComponent(row.last_seen_at)}`}
        alt={row.temporary_name}
        loading="lazy"
        decoding="async"
      />
      <div className="min-w-0 p-3">
        <div className="flex items-start justify-between gap-1.5"><strong className="truncate text-[11px] text-zinc-800">{row.temporary_name}</strong><span className={`shrink-0 rounded-md px-1.5 py-1 text-[7px] font-extrabold ${linked ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusLabel}</span></div>
        <p className="mt-2 text-[9px] leading-4 text-zinc-500"><strong className="text-zinc-700">{compactNumber(row.detection_count)}</strong> detecciones · {localTime(row.first_seen_at)} a {localTime(row.last_seen_at)}</p>
        <div className="mt-2.5 flex gap-1.5">
          <Button
            className="min-w-0 flex-1 px-2"
            onClick={() => onOpenDetail({
              scope: "day",
              kind: "unknown",
              subjectKey: row.subject_id,
              date,
              includeAllCrops: true,
            })}
            type="button"
          >
            Recortes <ChevronRight size={11} />
          </Button>
          {selectionMode ? (
            <Button
              aria-pressed={selectedForAction}
              className="min-w-0 flex-1 px-2"
              disabled={linked}
              onClick={onToggleSelection}
              tone={selectedForAction ? "primary" : "secondary"}
              type="button"
            >
              {selectedForAction ? <><CheckSquare2 size={12} /> Seleccionado</> : <><Square size={12} /> Seleccionar</>}
            </Button>
          ) : (
            <Button className="min-w-0 flex-1 px-2" disabled={linked} onClick={() => setLinking(true)} tone="primary" type="button">{linked ? <><Check size={11} /> Confirmado</> : <><Link2 size={11} /> Vincular</>}</Button>
          )}
        </div>
        {!selectionMode && !linked && row.best_crop_id ? (
          <Button
            className="mt-1.5 min-h-8 w-full px-2 text-[10px]"
            data-testid={`discard-daily-crop-${row.best_crop_id}`}
            onClick={onReject}
            tone="danger"
            type="button"
          >
            <Ban size={11} /> Descartar este recorte
          </Button>
        ) : null}
        {linking && !linked ? (
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <label className="relative block"><Search className="absolute left-2.5 top-2.5 text-zinc-400" size={13} /><input className="min-h-9 w-full rounded-lg border border-zinc-200 pl-8 pr-2 text-[10px]" autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Nombre o equipo..." type="search" /></label>
            <div className="mt-1.5 grid max-h-36 gap-1 overflow-y-auto">
              {query.trim().length < 2 ? <span className="px-1 py-1 text-[9px] text-zinc-400">Escribe al menos 2 letras.</span> : matches.length ? matches.map((person) => (
                <button key={person.person_key} className={`rounded-md border px-2 py-1.5 text-left ${selected?.person_key === person.person_key ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-zinc-50 hover:border-emerald-200"}`} onClick={() => { setSelected(person); setQuery(person.name); }} type="button"><strong className="block truncate text-[9px] text-zinc-700">{person.name}</strong><span className="block truncate text-[8px] text-zinc-400">{person.group_name || person.team_name || "Sin grupo"}</span></button>
              )) : <span className="px-1 py-1 text-[9px] text-zinc-400">Sin coincidencias.</span>}
            </div>
            <div className="mt-2 flex gap-1.5"><Button className="flex-1 px-2" onClick={() => { setLinking(false); setQuery(""); setSelected(null); }} type="button"><X size={11} /> Cancelar</Button><Button className="flex-1 px-2" disabled={!selected || saving} onClick={() => void confirm()} tone="primary" type="button">{saving ? "Guardando..." : "Confirmar"}</Button></div>
            <div className="mt-1.5 grid gap-1.5">
              <Button
                className="px-2"
                disabled={saving}
                onClick={() => {
                  setLinking(false);
                  setQuery("");
                  setSelected(null);
                  onRegisterNew("student");
                }}
                type="button"
              >
                <UserPlus size={11} /> Registrar nuevo alumno
              </Button>
              <Button
                className="px-2"
                disabled={saving}
                onClick={() => {
                  setLinking(false);
                  setQuery("");
                  setSelected(null);
                  onRegisterNew("collaborator");
                }}
                type="button"
              >
                <UserPlus size={11} /> Registrar nuevo colaborador
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
