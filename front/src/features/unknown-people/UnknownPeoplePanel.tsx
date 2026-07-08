import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, UserX } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import type { RegisteredUnknownPerson, UnknownAttendanceStatus, UnknownSubject } from "../unknown-attendance";
import { UnknownSubjectCard } from "./UnknownPeopleCards";
import { UnknownPersonModal } from "./UnknownPersonModal";

const CARD_PAGE_SIZE = 8;

export function UnknownPeoplePanel({
  token,
  data,
  subjectToOpen,
  onSubjectOpened,
  onRefreshData,
}: {
  token: string;
  data: AppData;
  subjectToOpen?: string;
  onSubjectOpened?: () => void;
  onRefreshData: () => void;
}) {
  const [status, setStatus] = useState<UnknownAttendanceStatus | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<UnknownSubject | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [subjectPage, setSubjectPage] = useState(0);
  const [acceptingSubjectId, setAcceptingSubjectId] = useState("");
  const [discardingSubjectId, setDiscardingSubjectId] = useState("");

  const subjects = status?.subjects ?? [];
  const acceptingSubject = acceptingSubjectId ? subjects.find((subject) => subject.id === acceptingSubjectId) : undefined;
  const discardingSubject = discardingSubjectId ? subjects.find((subject) => subject.id === discardingSubjectId) : undefined;
  const pendingRegistrationCount = subjects.filter((subject) => !subject.matched_player_id && !subject.matched_student_id && !subject.metadata?.accepted_at).length;
  const filteredSubjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return subjects;
    return subjects.filter((subject) => `${subject.temporary_name} ${subject.id}`.toLowerCase().includes(needle));
  }, [query, subjects]);

  async function loadStatus() {
    setLoading(true);
    try {
      const nextStatus = await apiRequest<UnknownAttendanceStatus>("/unknown-attendance/status/?pending_limit=0&recent_limit=0&subject_limit=250&report_limit=0", token);
      setStatus(nextStatus);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar desconocidos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, [token]);

  useEffect(() => {
    setSubjectPage(0);
  }, [query]);

  useEffect(() => {
    setSubjectPage((page) => clampPage(page, filteredSubjects.length));
  }, [filteredSubjects.length]);

  useEffect(() => {
    if (!subjectToOpen || !subjects.length) return;
    const subject = subjects.find((item) => item.id === subjectToOpen);
    if (!subject) return;
    setSelectedSubject(subject);
    onSubjectOpened?.();
  }, [onSubjectOpened, subjectToOpen, subjects]);

  async function handleRegistered(result: RegisteredUnknownPerson) {
    setMessage(`${result.full_name} quedo registrado como ${result.person_type === "player" ? "jugador adulto" : "alumno"}.`);
    setSelectedSubject(null);
    await loadStatus();
    onRefreshData();
  }

  async function acceptUnknownSubject(subjectId: string) {
    setAcceptingSubjectId(subjectId);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/unknown-attendance/subjects/${encodeURIComponent(subjectId)}/accept/`, token, { method: "POST" });
      setMessage("Desconocido aceptado y guardado en memoria.");
      await loadStatus();
      onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aceptar el desconocido.");
    } finally {
      setAcceptingSubjectId("");
    }
  }

  async function discardUnknownSubject(subjectId: string) {
    const subject = subjects.find((item) => item.id === subjectId);
    const label = subject?.temporary_name || "este desconocido";
    if (!window.confirm(`Rechazar ${label}? Ya no aparecera en desconocidos consolidados.`)) return;
    setDiscardingSubjectId(subjectId);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/unknown-attendance/subjects/${encodeURIComponent(subjectId)}/discard/`, token, { method: "POST" });
      setMessage("Desconocido rechazado. Ya no aparecera en consolidados.");
      if (selectedSubject?.id === subjectId) setSelectedSubject(null);
      await loadStatus();
      onRefreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo rechazar el desconocido.");
    } finally {
      setDiscardingSubjectId("");
    }
  }

  if (!status && loading) {
    return <UnknownPeopleSkeleton onRefresh={loadStatus} loading={loading} error={error} />;
  }

  return (
    <div className="grid gap-5">
      {acceptingSubjectId && <AcceptingUnknownOverlay label={acceptingSubject?.temporary_name || "desconocido"} />}
      {discardingSubjectId && <BusyUnknownOverlay label={discardingSubject?.temporary_name || "desconocido"} title="Rechazando desconocido" detail="Quitando este consolidado de la lista para que no vuelva a estorbar en la revision." tone="red" />}
      {selectedSubject && <UnknownPersonModal subject={selectedSubject} token={token} data={data} onAccept={acceptUnknownSubject} onClose={() => setSelectedSubject(null)} onDiscard={discardUnknownSubject} onRegistered={handleRegistered} />}
      <section className="motion-card rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Ventanilla</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <UserX size={18} /> Desconocidos
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">Personas desconocidas consolidadas por el modelo. Abre un registro para pedir su nombre y agregarlo al sistema.</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={loadStatus} type="button">
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Consolidados" value={subjects.length} />
          <Metric label="Por registrar" value={pendingRegistrationCount} />
          <Metric label="Con evidencia" value={subjects.filter((subject) => Boolean(subject.image_url)).length} />
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Search size={15} className="text-zinc-400" />
          <input className="w-full bg-transparent outline-none" placeholder="Buscar por nombre temporal o ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {message && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && (
          <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Cargando desconocidos...
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <SectionPager count={filteredSubjects.length} page={subjectPage} title="Desconocidos consolidados" onNext={() => setSubjectPage((page) => clampPage(page + 1, filteredSubjects.length))} onPrevious={() => setSubjectPage((page) => clampPage(page - 1, filteredSubjects.length))} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {pageSlice(filteredSubjects, subjectPage).map((subject) => <UnknownSubjectCard accepting={acceptingSubjectId === subject.id} discarding={discardingSubjectId === subject.id} key={subject.id} subject={subject} token={token} onAccept={(subjectId) => void acceptUnknownSubject(subjectId)} onDiscard={(subjectId) => void discardUnknownSubject(subjectId)} onOpen={setSelectedSubject} />)}
          {!loading && !filteredSubjects.length && <EmptyState label="No hay desconocidos consolidados con ese filtro." />}
        </div>
      </section>
    </div>
  );
}

function AcceptingUnknownOverlay({ label }: { label: string }) {
  return <BusyUnknownOverlay detail="Guardando el recorte consolidado en memoria. Esto puede tardar unos segundos si Supabase responde lento." label={label} title="Aceptando desconocido" tone="emerald" />;
}

function BusyUnknownOverlay({ detail, label, title, tone }: { detail: string; label: string; title: string; tone: "emerald" | "red" }) {
  const toneClass = tone === "emerald" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200";
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-zinc-950/60 px-4">
      <div className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-5 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className={`mx-auto grid size-12 place-items-center rounded-full ${toneClass}`}>
          <Loader2 className="animate-spin" size={24} />
        </div>
        <h3 className="mt-4 text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
        <p className="mt-1 break-words text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</p>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{detail}</p>
      </div>
    </div>
  );
}

function clampPage(page: number, count: number) {
  const maxPage = Math.max(0, Math.ceil(count / CARD_PAGE_SIZE) - 1);
  return Math.min(Math.max(page, 0), maxPage);
}

function pageSlice<T>(items: T[], page: number) {
  const start = page * CARD_PAGE_SIZE;
  return items.slice(start, start + CARD_PAGE_SIZE);
}

function SectionPager({ count, onNext, onPrevious, page, title }: { count: number; onNext: () => void; onPrevious: () => void; page: number; title: string }) {
  const totalPages = Math.max(1, Math.ceil(count / CARD_PAGE_SIZE));
  const start = count ? page * CARD_PAGE_SIZE + 1 : 0;
  const end = Math.min(count, (page + 1) * CARD_PAGE_SIZE);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
        <p className="text-sm text-zinc-500">{count ? `${start}-${end} de ${count}` : "0 registros"}</p>
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" disabled={page <= 0} onClick={onPrevious} type="button">
          Anterior
        </button>
        <span className="min-w-16 text-center text-sm text-zinc-500">
          {page + 1}/{totalPages}
        </span>
        <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" disabled={page >= totalPages - 1} onClick={onNext} type="button">
          Siguiente
        </button>
      </div>
    </div>
  );
}

function UnknownPeopleSkeleton({ error, loading, onRefresh }: { error: string; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="grid gap-5">
      <section className="motion-card rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Ventanilla</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <UserX size={18} /> Desconocidos
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">Cargando desconocidos consolidados...</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw size={15} /> {loading ? "Cargando..." : "Reintentar"}
          </button>
        </div>
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Cargando desconocidos...
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="mt-3 h-7 w-14" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <Search size={15} className="text-zinc-400" />
          <SkeletonBlock className="h-4 w-52" />
        </div>
      </section>

      <SkeletonCardSection title="Desconocidos consolidados" />
    </div>
  );
}

function SkeletonCardSection({ title }: { title: string }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
        <SkeletonBlock className="h-4 w-6" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <SkeletonBlock className="aspect-square w-full" />
            <SkeletonBlock className="mt-3 h-4 w-32" />
            <SkeletonBlock className="mt-2 h-3 w-44 max-w-full" />
            <SkeletonBlock className="mt-3 h-8 w-28" />
          </div>
        ))}
      </div>
    </section>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`} />;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-8 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950">{label}</p>;
}
