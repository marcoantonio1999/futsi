import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Ban,
  Check,
  Copy,
  Eye,
  ImageOff,
  Link2,
  Search,
  ShieldX,
  UserRound,
  UsersRound,
} from "lucide-react";
import { stationApi, toQuery } from "./api";
import { Button, EmptyState, FilterChip, LoadingState, panelClass } from "./components";
import { compactNumber, identityTypeLabel, initials, localTime } from "./format";
import { useDebouncedValue, useInfiniteTrigger } from "./hooks";
import type {
  DetectionTarget,
  IdentityResponse,
  IdentityRow,
  IdentityStatus,
  IdentitySummary,
  UnknownCatalogStatus,
  UnknownIdentityResponse,
  UnknownIdentityRow,
  UnknownIdentitySummary,
} from "./types";

const IDENTITY_BATCH_SIZE = 48;
const emptySummary: IdentitySummary = {
  identities: 0,
  ready: 0,
  missing: 0,
  duplicates: 0,
  unknown_total: 0,
  unknown_review: 0,
  unknown_candidate: 0,
  unknown_consolidated: 0,
  unknown_linked: 0,
  unknown_ignored: 0,
  unknown_quarantined: 0,
  unknown_archived: 0,
};
const emptyUnknownSummary: UnknownIdentitySummary = {
  total: 0,
  review: 0,
  candidate: 0,
  consolidated: 0,
  linked: 0,
  ignored: 0,
  quarantined: 0,
  archived: 0,
};

function mergeUnknownSummary(
  base: IdentitySummary,
  unknown: UnknownIdentitySummary,
): IdentitySummary {
  return {
    ...base,
    unknown_total: unknown.total,
    unknown_review: unknown.review,
    unknown_candidate: unknown.candidate,
    unknown_consolidated: unknown.consolidated,
    unknown_linked: unknown.linked,
    unknown_ignored: unknown.ignored,
    unknown_quarantined: unknown.quarantined,
    unknown_archived: unknown.archived,
  };
}

const unknownFilters: Array<{
  value: UnknownCatalogStatus;
  label: string;
  summaryKey: keyof UnknownIdentitySummary;
}> = [
  { value: "all", label: "Todos", summaryKey: "total" },
  { value: "review", label: "Por revisar", summaryKey: "review" },
  { value: "candidate", label: "Candidatos", summaryKey: "candidate" },
  { value: "consolidated", label: "En comparación", summaryKey: "consolidated" },
  { value: "linked", label: "Vinculados", summaryKey: "linked" },
  { value: "ignored", label: "Fuera de lista", summaryKey: "ignored" },
  { value: "quarantined", label: "No válidos", summaryKey: "quarantined" },
  { value: "archived", label: "Fusionados", summaryKey: "archived" },
];

export function IdentityCatalogView({
  onOpenDetail,
}: {
  onOpenDetail: (target: DetectionTarget) => void;
}) {
  const [status, setStatus] = useState<IdentityStatus>("all");
  const [unknownStatus, setUnknownStatus] = useState<UnknownCatalogStatus>("all");
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim());
  const [rows, setRows] = useState<IdentityRow[]>([]);
  const [unknownRows, setUnknownRows] = useState<UnknownIdentityRow[]>([]);
  const [summary, setSummary] = useState<IdentitySummary>(emptySummary);
  const [unknownSummary, setUnknownSummary] =
    useState<UnknownIdentitySummary>(emptyUnknownSummary);
  const [unknownSnapshot, setUnknownSnapshot] = useState<number | null>(null);
  const [unknownOffset, setUnknownOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const syncUnknownSummary = useCallback((next: UnknownIdentitySummary) => {
    setUnknownSummary(next);
    setSummary((current) => mergeUnknownSummary(current, next));
  }, []);

  const loadFirstPage = useCallback(async () => {
    const id = ++requestId.current;
    setRows([]);
    setUnknownRows([]);
    setUnknownSnapshot(null);
    setUnknownOffset(0);
    setLoading(true);
    setError("");
    try {
      if (status === "unknown") {
        const [payload, identityPayload] = await Promise.all([
          stationApi<UnknownIdentityResponse>(
            `/api/unknowns/catalog?${toQuery({
              q: query,
              status: unknownStatus,
              offset: 0,
              limit: IDENTITY_BATCH_SIZE,
            })}`,
          ),
          stationApi<IdentityResponse>(
            `/api/identities?${toQuery({
              status: "all",
              offset: 0,
              limit: 1,
            })}`,
          ),
        ]);
        if (id !== requestId.current) return;
        const nextUnknownSummary = payload.summary || emptyUnknownSummary;
        setUnknownRows(payload.items || []);
        setUnknownSnapshot(Number(payload.snapshot || 0) || null);
        setUnknownOffset((payload.items || []).length);
        setTotal(Number(payload.total || 0));
        setUnknownSummary(nextUnknownSummary);
        setSummary(
          mergeUnknownSummary(
            identityPayload.summary || emptySummary,
            nextUnknownSummary,
          ),
        );
      } else {
        const payload = await stationApi<IdentityResponse>(
          `/api/identities?${toQuery({
            q: query,
            status,
            offset: 0,
            limit: IDENTITY_BATCH_SIZE,
          })}`,
        );
        if (id !== requestId.current) return;
        setRows(payload.items || []);
        setTotal(Number(payload.total || 0));
        setSummary(payload.summary || emptySummary);
      }
    } catch (reason) {
      if (id === requestId.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo abrir la base local.",
        );
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [query, status, syncUnknownSummary, unknownStatus]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const visibleCount =
    status === "unknown" ? unknownRows.length : rows.length;
  const hasMore =
    status === "unknown" ? unknownOffset < total : visibleCount < total;
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const id = requestId.current;
    try {
      if (status === "unknown") {
        const payload = await stationApi<UnknownIdentityResponse>(
          `/api/unknowns/catalog?${toQuery({
            q: query,
            status: unknownStatus,
            offset: unknownOffset,
            limit: IDENTITY_BATCH_SIZE,
            ...(unknownSnapshot ? { snapshot: unknownSnapshot } : {}),
          })}`,
        );
        if (id !== requestId.current) return;
        setUnknownRows((current) => {
          const existing = new Set(current.map((row) => row.subject_id));
          return [
            ...current,
            ...(payload.items || []).filter(
              (row) => !existing.has(row.subject_id),
            ),
          ];
        });
        setUnknownOffset(
          Math.min(
            Number(payload.total || 0),
            Number(payload.offset || 0) + Number(payload.limit || 0),
          ),
        );
        setTotal(Number(payload.total || total));
        syncUnknownSummary(payload.summary || unknownSummary);
      } else {
        const payload = await stationApi<IdentityResponse>(
          `/api/identities?${toQuery({
            q: query,
            status,
            offset: rows.length,
            limit: IDENTITY_BATCH_SIZE,
          })}`,
        );
        if (id !== requestId.current) return;
        setRows((current) => [...current, ...(payload.items || [])]);
        setTotal(Number(payload.total || total));
        setSummary(payload.summary || summary);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudieron cargar más identidades.",
      );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [
    hasMore,
    loading,
    query,
    rows.length,
    status,
    summary,
    syncUnknownSummary,
    total,
    unknownOffset,
    unknownSnapshot,
    unknownStatus,
    unknownSummary,
  ]);
  const sentinelRef = useInfiniteTrigger(
    () => void loadMore(),
    hasMore && !loading,
  );

  const filter = (next: IdentityStatus) => {
    setStatus(next);
  };

  const totalLocalIdentities = summary.identities + summary.unknown_total;
  const isUnknownView = status === "unknown";

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">
            Directorio sincronizado
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">
            Base local de identidades
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Personas registradas y todos los rostros desconocidos conservados
            por esta estación.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-950/10 bg-white px-4 py-2.5 text-right shadow-sm">
          <span className="block text-[8px] font-extrabold uppercase tracking-wider text-zinc-400">
            Registros locales
          </span>
          <strong className="mt-0.5 block text-xl tabular-nums text-emerald-900">
            {compactNumber(totalLocalIdentities)}
          </strong>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <IdentityMetric
          active={status === "ready"}
          icon={<Check size={15} />}
          label="Listas para reconocer"
          value={summary.ready}
          detail="Foto y embedding local"
          tone="emerald"
          onClick={() => filter("ready")}
        />
        <IdentityMetric
          active={status === "missing"}
          icon={<ImageOff size={15} />}
          label="Sin foto útil"
          value={summary.missing}
          detail="Pendientes de referencia"
          tone="amber"
          onClick={() => filter("missing")}
        />
        <IdentityMetric
          active={status === "duplicates"}
          icon={<Copy size={15} />}
          label="Registros duplicados"
          value={summary.duplicates}
          detail="Identidad registrada repetida"
          tone="blue"
          onClick={() => filter("duplicates")}
        />
        <IdentityMetric
          active={status === "unknown"}
          icon={<UserRound size={15} />}
          label="Desconocidos locales"
          value={summary.unknown_total}
          detail={`${compactNumber(summary.unknown_review)} por revisar`}
          tone="violet"
          onClick={() => filter("unknown")}
        />
      </section>

      <section className={panelClass}>
        <div className="flex flex-col gap-3 border-b border-zinc-200 bg-white px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <label className="block w-full max-w-lg text-[9px] font-extrabold uppercase tracking-wider text-zinc-500">
            {isUnknownView
              ? "Buscar desconocido por número o vínculo"
              : "Buscar persona, grupo o equipo"}
            <span className="relative mt-1.5 block">
              <Search
                className="absolute left-3 top-3 text-zinc-400"
                size={15}
              />
              <input
                className="min-h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-xs font-medium normal-case tracking-normal text-zinc-800 shadow-inner"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={100}
                placeholder={
                  isUnknownView
                    ? "Ej. Desconocido 14298"
                    : "Ej. Ana, Sub 15 o equipo verde"
                }
                type="search"
              />
            </span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(
              ["all", "ready", "missing", "duplicates", "unknown"] as IdentityStatus[]
            ).map((value) => (
              <FilterChip
                key={value}
                active={status === value}
                onClick={() => filter(value)}
              >
                {
                  {
                    all: "Registrados",
                    ready: "Listos",
                    missing: "Sin foto",
                    duplicates: "Duplicados",
                    unknown: "Desconocidos",
                  }[value]
                }
              </FilterChip>
            ))}
          </div>
        </div>

        {isUnknownView ? (
          <div className="station-scrollbar flex gap-1.5 overflow-x-auto border-b border-zinc-100 bg-zinc-50/70 px-4 py-2.5">
            {unknownFilters.map((item) => (
              <FilterChip
                key={item.value}
                active={unknownStatus === item.value}
                onClick={() => setUnknownStatus(item.value)}
              >
                {item.label} ·{" "}
                {compactNumber(unknownSummary[item.summaryKey] || 0)}
              </FilterChip>
            ))}
          </div>
        ) : null}

        <div className="flex min-h-11 flex-col gap-1 border-b border-zinc-100 px-4 py-2.5 text-[10px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {query
              ? `Mostrando ${compactNumber(visibleCount)} de ${compactNumber(total)} coincidencias para “${query}”.`
              : isUnknownView
                ? `Mostrando ${compactNumber(visibleCount)} de ${compactNumber(total)} rostros desconocidos.`
                : `Mostrando ${compactNumber(visibleCount)} de ${compactNumber(total)} identidades registradas.`}
          </p>
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
            <i className="size-1.5 rounded-full bg-emerald-500" /> Datos
            disponibles sin internet
          </span>
        </div>

        {loading && !visibleCount ? (
          <LoadingState label="Cargando base local..." />
        ) : error && !visibleCount ? (
          <EmptyState
            error
            title="No se pudo abrir la base local"
            detail={error}
            action={
              <Button onClick={() => void loadFirstPage()}>Reintentar</Button>
            }
          />
        ) : !visibleCount ? (
          <EmptyState
            title="Sin coincidencias"
            detail="Prueba otro nombre o cambia el filtro seleccionado."
          />
        ) : (
          <div className="grid min-h-72 content-start gap-2.5 bg-zinc-50/70 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {isUnknownView
              ? unknownRows.map((row) => (
                  <UnknownIdentityCard
                    key={row.subject_id}
                    row={row}
                    onOpen={() => {
                      const month = row.last_seen_at.slice(0, 7);
                      if (/^\d{4}-\d{2}$/.test(month)) {
                        onOpenDetail({
                          scope: "month",
                          kind: "unknown",
                          subjectKey: row.subject_id,
                          month,
                          includeAllCrops: true,
                        });
                      }
                    }}
                  />
                ))
              : rows.map((row) => (
                  <IdentityCard key={row.person_key} row={row} />
                ))}
            {hasMore ? (
              <button
                ref={sentinelRef}
                className="col-span-full flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-white text-[10px] font-semibold text-zinc-500 hover:border-emerald-300 hover:text-emerald-700"
                onClick={() => void loadMore()}
                type="button"
              >
                <UsersRound size={14} />{" "}
                {loading
                  ? "Cargando más identidades..."
                  : `Desplázate para cargar más · ${compactNumber(visibleCount)} de ${compactNumber(total)}`}
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function IdentityMetric({
  active,
  icon,
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  tone: "emerald" | "amber" | "blue" | "violet";
  onClick: () => void;
}) {
  const tones = {
    emerald: "text-emerald-700 bg-emerald-50",
    amber: "text-amber-700 bg-amber-50",
    blue: "text-blue-700 bg-blue-50",
    violet: "text-violet-700 bg-violet-50",
  };
  return (
    <button
      className={`rounded-xl border bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-px hover:shadow-md ${active ? "border-emerald-400 ring-2 ring-emerald-100" : "border-emerald-950/10"}`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide ${tones[tone]}`}
      >
        {icon}
        {label}
      </span>
      <strong className="mt-2 block text-2xl tabular-nums text-zinc-900">
        {compactNumber(value)}
      </strong>
      <small className="mt-1 block truncate text-[9px] text-zinc-400">
        {detail}
      </small>
    </button>
  );
}

function UnknownIdentityCard({
  row,
  onOpen,
}: {
  row: UnknownIdentityRow;
  onOpen: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const meta = unknownStatusMeta(row.status);
  const quality = Math.round(Math.max(0, Number(row.quality_score || 0)) * 100);
  const context =
    row.status === "linked"
      ? `Vinculado con ${row.linked_person_name || row.linked_person_key || "registro"}`
      : row.status === "archived"
        ? `Fusionado en ${row.merged_into_name || row.merged_into || "otra identidad"}`
        : meta.detail;
  const canOpen = /^\d{4}-\d{2}/.test(row.last_seen_at || "");

  return (
    <article className="grid min-h-32 min-w-0 grid-cols-[104px_minmax(0,1fr)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-px hover:border-violet-200 hover:shadow-md">
      <div className="relative min-h-32 overflow-hidden bg-gradient-to-br from-zinc-100 to-violet-50">
        {row.image_available && !imageFailed ? (
          <img
            className="absolute inset-0 size-full object-cover"
            src={`/api/unknowns/catalog/${encodeURIComponent(row.subject_id)}/image?v=${encodeURIComponent(row.updated_at || row.last_seen_at)}`}
            alt={`Recorte de ${row.temporary_name}`}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="grid size-full place-items-center text-violet-300">
            <ImageOff size={24} />
          </span>
        )}
        <span
          className={`absolute left-1.5 top-1.5 rounded-md border border-white/70 px-1.5 py-1 text-[7px] font-extrabold uppercase shadow-sm ${meta.badge}`}
        >
          {meta.label}
        </span>
      </div>
      <div className="flex min-w-0 flex-col p-2.5">
        <strong
          className="truncate text-[10px] leading-4 text-zinc-800"
          title={row.temporary_name}
        >
          {row.temporary_name}
        </strong>
        <p className="mt-0.5 line-clamp-2 text-[8px] leading-3.5 text-zinc-400">
          {context}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[8px]">
          <span className="rounded bg-zinc-50 px-1.5 py-1 text-zinc-500">
            <b className="text-zinc-700">{compactNumber(row.detection_count)}</b>{" "}
            detecciones
          </span>
          <span className="rounded bg-zinc-50 px-1.5 py-1 text-zinc-500">
            <b className="text-zinc-700">{compactNumber(row.crop_count)}</b>{" "}
            recortes
          </span>
          <span className="rounded bg-zinc-50 px-1.5 py-1 text-zinc-500">
            Calidad <b className="text-zinc-700">{quality}%</b>
          </span>
          <span className="truncate rounded bg-zinc-50 px-1.5 py-1 text-zinc-500">
            {localTime(row.last_seen_at)}
          </span>
        </div>
        <Button
          className="mt-auto min-h-7 w-full px-2 pt-1.5 text-[8px]"
          disabled={!canOpen}
          onClick={onOpen}
          type="button"
        >
          <Eye size={10} />{" "}
          {row.status === "archived" ? "Ver identidad final" : "Revisar recortes"}
        </Button>
      </div>
    </article>
  );
}

function unknownStatusMeta(status: UnknownIdentityRow["status"]) {
  const statuses = {
    candidate: {
      label: "Candidato",
      detail: "Pendiente de una referencia frontal aprobada.",
      badge: "bg-amber-600 text-white",
      icon: Ban,
    },
    consolidated: {
      label: "En comparación",
      detail: "Ya participa en las comparaciones de desconocidos.",
      badge: "bg-violet-700 text-white",
      icon: UserRound,
    },
    linked: {
      label: "Vinculado",
      detail: "Ya corresponde a una persona registrada.",
      badge: "bg-blue-700 text-white",
      icon: Link2,
    },
    ignored: {
      label: "Fuera de lista",
      detail: "Se reconoce, pero no genera asistencia.",
      badge: "bg-zinc-700 text-white",
      icon: ShieldX,
    },
    quarantined: {
      label: "No válido",
      detail: "No participa en asistencia ni comparaciones.",
      badge: "bg-red-700 text-white",
      icon: ShieldX,
    },
    archived: {
      label: "Fusionado",
      detail: "Alias histórico unido a otra identidad.",
      badge: "bg-slate-600 text-white",
      icon: Archive,
    },
  };
  return statuses[status] || {
    label: "Estado local",
    detail: "Registro conservado para revisión.",
    badge: "bg-zinc-600 text-white",
    icon: Archive,
  };
}

function IdentityCard({ row }: { row: IdentityRow }) {
  const ready = Boolean(row.reference_ready);
  const duplicate = Number(row.registration_count || 0) > 1;
  const [imageFailed, setImageFailed] = useState(false);
  const context = row.group_name || row.team_name || "Sin grupo asignado";
  return (
    <article className="grid min-h-24 min-w-0 grid-cols-[74px_minmax(0,1fr)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-px hover:border-emerald-200 hover:shadow-md">
      <div
        className={`relative min-h-24 overflow-hidden ${ready && !imageFailed ? "bg-zinc-100" : "bg-gradient-to-br from-zinc-100 to-emerald-50"}`}
      >
        {ready && !imageFailed ? (
          <img
            className="absolute inset-0 size-full object-cover"
            src={`/api/images/person/${encodeURIComponent(row.person_key)}`}
            alt={`Foto de ${row.name}`}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="grid size-full place-items-center text-lg font-extrabold text-zinc-500">
            {initials(row.name)}
          </span>
        )}
        <span
          className={`absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-full border-2 border-white text-[8px] font-black text-white ${ready && !imageFailed ? "bg-emerald-600" : "bg-amber-500"}`}
        >
          {ready && !imageFailed ? "✓" : "!"}
        </span>
      </div>
      <div className="flex min-w-0 flex-col p-2.5">
        <div className="flex items-start justify-between gap-1.5">
          <strong
            className="truncate text-[10px] leading-4 text-zinc-800"
            title={row.name}
          >
            {row.name}
          </strong>
          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-1 text-[7px] font-extrabold uppercase text-blue-700">
            {identityTypeLabel(row.person_type)}
          </span>
        </div>
        <p className="mt-1 truncate text-[9px] text-zinc-400" title={context}>
          {context}
        </p>
        <div className="mt-auto flex items-end justify-between gap-1 pt-2">
          <span
            className={`inline-flex min-w-0 items-center gap-1 truncate text-[8px] font-bold ${ready && !imageFailed ? "text-emerald-700" : "text-amber-700"}`}
          >
            <i
              className={`size-1.5 shrink-0 rounded-full ${ready && !imageFailed ? "bg-emerald-500" : "bg-amber-500"}`}
            />{" "}
            {ready && !imageFailed ? "Lista para reconocer" : "Sin foto útil"}
          </span>
          <span
            className={`shrink-0 text-[7px] ${duplicate ? "font-bold text-blue-600" : "text-zinc-400"}`}
          >
            {duplicate ? `Duplicado · ${row.registration_count}` : "1 registro"}
          </span>
        </div>
      </div>
    </article>
  );
}
