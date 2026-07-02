import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, UserX } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import type { RegisteredUnknownPerson, UnknownAttendanceStatus, UnknownSubject } from "../unknown-attendance";
import { UnknownCaptureCard, UnknownSubjectCard } from "./UnknownPeopleCards";
import { UnknownPersonModal } from "./UnknownPersonModal";

export function UnknownPeoplePanel({ token, data, onRefreshData }: { token: string; data: AppData; onRefreshData: () => void }) {
  const [status, setStatus] = useState<UnknownAttendanceStatus | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<UnknownSubject | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const subjects = status?.subjects ?? [];
  const captures = useMemo(() => {
    const knownSubjectIds = new Set(subjects.map((subject) => subject.id));
    return (status?.recent ?? []).filter((capture) => capture.status !== "matched_known" && (!capture.subject_id || !knownSubjectIds.has(capture.subject_id)));
  }, [status?.recent, subjects]);
  const filteredSubjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return subjects;
    return subjects.filter((subject) => `${subject.temporary_name} ${subject.id}`.toLowerCase().includes(needle));
  }, [query, subjects]);

  async function loadStatus() {
    setLoading(true);
    try {
      const nextStatus = await apiRequest<UnknownAttendanceStatus>("/unknown-attendance/status/?pending_limit=0&recent_limit=250&subject_limit=250&report_limit=0", token);
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

  function openSubjectById(subjectId: string) {
    const subject = subjects.find((item) => item.id === subjectId);
    if (subject) setSelectedSubject(subject);
    else setError("Ese desconocido no esta en la lista cargada. Actualiza la seccion.");
  }

  async function handleRegistered(result: RegisteredUnknownPerson) {
    setMessage(`${result.full_name} quedo registrado como ${result.person_type === "player" ? "jugador adulto" : "alumno"}.`);
    setSelectedSubject(null);
    await loadStatus();
    onRefreshData();
  }

  return (
    <div className="grid gap-5">
      {selectedSubject && <UnknownPersonModal subject={selectedSubject} token={token} data={data} onClose={() => setSelectedSubject(null)} onRegistered={handleRegistered} />}
      <section className="motion-card rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Ventanilla</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <UserX size={18} /> Desconocidos
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">Rostros consolidados y capturas no consolidadas detectadas por las camaras. Abre un rostro consolidado para registrarlo como persona nueva.</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={loadStatus} type="button">
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Consolidados" value={subjects.length} />
          <Metric label="No consolidados" value={captures.length} />
          <Metric label="Pendientes" value={status?.pending_count ?? 0} />
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Search size={15} className="text-zinc-400" />
          <input className="w-full bg-transparent outline-none" placeholder="Buscar por nombre temporal o ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {message && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="mt-3 text-sm text-zinc-500">Cargando desconocidos...</p>}
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Consolidados</h3>
          <span className="text-sm text-zinc-500">{filteredSubjects.length}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {filteredSubjects.map((subject) => <UnknownSubjectCard key={subject.id} subject={subject} token={token} onOpen={setSelectedSubject} />)}
          {!filteredSubjects.length && <EmptyState label="No hay rostros consolidados con ese filtro." />}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Capturas no consolidadas</h3>
          <span className="text-sm text-zinc-500">{captures.length}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {captures.map((capture) => <UnknownCaptureCard key={capture.id} capture={capture} token={token} onOpenSubject={openSubjectById} />)}
          {!captures.length && <EmptyState label="No hay capturas no consolidadas visibles." />}
        </div>
      </section>
    </div>
  );
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
