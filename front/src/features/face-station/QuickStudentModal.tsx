import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Check,
  Image as ImageIcon,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  UserPlus,
  X,
} from "lucide-react";
import { stationApi } from "./api";
import { Button, EmptyState, LoadingState } from "./components";
import { localTime } from "./format";
import { useEscape } from "./hooks";
import type {
  StudentRegistrationCrop,
  StudentRegistrationCropsResponse,
  UnknownAttendance,
} from "./types";

const REGISTRATION_CROP_BATCH_SIZE = 42;

export function QuickStudentModal({
  row,
  personType,
  saving,
  onClose,
  onConfirm,
}: {
  row: Pick<UnknownAttendance, "subject_id" | "temporary_name">;
  personType: "student" | "collaborator";
  saving: boolean;
  onClose: () => void;
  onConfirm: (fullName: string, cropId: number) => void;
}) {
  const isCollaborator = personType === "collaborator";
  const personLabel = isCollaborator ? "colaborador" : "alumno";
  const [fullName, setFullName] = useState("");
  const [payload, setPayload] = useState<StudentRegistrationCropsResponse | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<number | null>(null);
  const [visibleCropCount, setVisibleCropCount] = useState(REGISTRATION_CROP_BATCH_SIZE);
  const [error, setError] = useState("");
  useEscape(() => {
    if (!saving) onClose();
  });

  useEffect(() => {
    const controller = new AbortController();
    setPayload(null);
    setVisibleCropCount(REGISTRATION_CROP_BATCH_SIZE);
    setError("");
    stationApi<StudentRegistrationCropsResponse>(
      `/api/unknowns/${encodeURIComponent(row.subject_id)}/registration-crops`,
      { signal: controller.signal },
    )
      .then((result) => {
        setPayload(result);
        setSelectedCropId(result.suggested_crop_id || result.crops[0]?.id || null);
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== "AbortError") {
          setError(reason instanceof Error ? reason.message : "No se pudieron cargar los recortes.");
        }
      });
    return () => controller.abort();
  }, [row.subject_id]);

  const normalizedName = useMemo(() => fullName.trim().replace(/\s+/g, " "), [fullName]);
  const canSubmit = normalizedName.length >= 3 && Boolean(selectedCropId) && !saving;
  const suggestedCropId = payload?.suggested_crop_id || null;
  const orderedCrops = useMemo(() => {
    const crops = payload?.crops || [];
    if (!suggestedCropId) return crops;
    const suggestedIndex = crops.findIndex((crop) => crop.id === suggestedCropId);
    if (suggestedIndex <= 0) return crops;
    return [
      crops[suggestedIndex],
      ...crops.slice(0, suggestedIndex),
      ...crops.slice(suggestedIndex + 1),
    ];
  }, [payload?.crops, suggestedCropId]);
  const visibleCrops = orderedCrops.slice(0, visibleCropCount);
  const remainingCrops = Math.max(0, orderedCrops.length - visibleCrops.length);

  return (
    <div
      className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-emerald-950/80 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
      role="presentation"
    >
      <section
        className="my-auto flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-50 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-person-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">
              <UserPlus size={14} /> Alta rápida
            </p>
            <h2 id="quick-person-title" className="mt-1 text-lg font-bold tracking-tight text-zinc-900">
              Registrar como nuevo {personLabel}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              Escribe su nombre completo y elige la fotografía que FaceGuard usará para reconocerlo desde ahora.
            </p>
          </div>
          <button
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="station-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <label className="block">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-zinc-500">
              Nombre completo
            </span>
            <input
              autoFocus
              className="mt-1.5 min-h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-800 shadow-sm outline-none transition placeholder:font-normal placeholder:text-zinc-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              disabled={saving}
              maxLength={isCollaborator ? 150 : 160}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Ej. Diego Hernández López"
              type="text"
              value={fullName}
            />
          </label>

          <div className="mt-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-wider text-zinc-500">
                Fotografía de referencia
              </p>
              <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                Sugerimos el recorte con mejor calidad facial. Puedes seleccionar cualquier otro.
              </p>
            </div>
            {payload?.crops.length ? (
              <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-bold text-zinc-500">
                {visibleCrops.length} de {payload.crops.length} recortes
              </span>
            ) : null}
          </div>

          {!payload && !error ? <LoadingState label="Preparando los recortes disponibles..." /> : null}
          {error ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-white">
              <EmptyState error title="No se pudieron cargar las fotografías" detail={error} />
            </div>
          ) : null}
          {payload && !payload.crops.length ? (
            <div className="mt-3 rounded-xl border border-zinc-200 bg-white">
              <EmptyState
                title="Este rostro no tiene recortes disponibles"
                detail="Es necesario conservar al menos una evidencia antes de registrar al alumno."
              />
            </div>
          ) : null}
          {payload?.crops.length ? (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7">
                {visibleCrops.map((crop) => (
                  <CropChoice
                    key={crop.id}
                    crop={crop}
                    selected={selectedCropId === crop.id}
                    suggested={suggestedCropId === crop.id}
                    disabled={saving}
                    onSelect={() => setSelectedCropId(crop.id)}
                  />
                ))}
              </div>
              {remainingCrops ? (
                <Button
                  className="mt-3 w-full border-dashed"
                  disabled={saving}
                  onClick={() => setVisibleCropCount((count) => count + REGISTRATION_CROP_BATCH_SIZE)}
                  type="button"
                >
                  <ImageIcon size={13} />
                  Mostrar {Math.min(REGISTRATION_CROP_BATCH_SIZE, remainingCrops)} recortes más
                </Button>
              ) : null}
            </>
          ) : null}

          <div className="mt-5 grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] leading-4 text-emerald-950 sm:grid-cols-2">
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={14} />
              {isCollaborator
                ? "Se registrará como personal activo de esta sede, sin crear una cuenta de acceso utilizable."
                : "Se registrará en la sede de esta estación; no necesitas capturar grupo ni categoría."}
            </span>
            <span className="flex items-start gap-2">
              <ImageIcon className="mt-0.5 shrink-0 text-emerald-700" size={14} />
              La foto elegida quedará privada y sus asistencias pasarán al nuevo {personLabel}.
            </span>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-zinc-500">
            Origen: <strong className="text-zinc-700">{row.temporary_name}</strong>
          </p>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={onClose} type="button">Cancelar</Button>
            <Button
              disabled={!canSubmit}
              onClick={() => selectedCropId && onConfirm(normalizedName, selectedCropId)}
              tone="primary"
              type="button"
            >
              {saving ? <LoaderCircle className="animate-spin" size={13} /> : <UserPlus size={13} />}
              {saving ? `Registrando ${personLabel}...` : `Registrar ${personLabel}`}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function CropChoice({
  crop,
  selected,
  suggested,
  disabled,
  onSelect,
}: {
  crop: StudentRegistrationCrop;
  selected: boolean;
  suggested: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`group relative overflow-hidden rounded-xl border-2 bg-white text-left shadow-sm transition ${
        selected
          ? "border-emerald-500 ring-2 ring-emerald-100"
          : "border-transparent hover:border-emerald-200"
      }`}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="relative block aspect-square overflow-hidden bg-zinc-100">
        <img
          alt={`Recorte de ${localTime(crop.seen_at)}`}
          className="size-full object-cover transition duration-200 group-hover:scale-105"
          decoding="async"
          loading="lazy"
          src={`/api/crops/${crop.id}/image`}
        />
        {suggested ? (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-700 px-1.5 py-1 text-[7px] font-extrabold uppercase tracking-wide text-white shadow">
            <Sparkles size={8} /> Sugerido
          </span>
        ) : null}
        <span className={`absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border shadow ${
          selected
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-white/80 bg-white/90 text-transparent"
        }`}>
          <Check size={11} strokeWidth={3} />
        </span>
      </span>
      <span className="block px-2 py-1.5">
        <strong className="block truncate text-[9px] text-zinc-700">
          Calidad {Math.round(Number(crop.quality || 0) * 100)}%
        </strong>
        <span className="mt-0.5 flex items-center gap-1 truncate text-[8px] text-zinc-400">
          <Camera size={8} /> {crop.camera || "Cámara local"} · {localTime(crop.seen_at)}
        </span>
      </span>
    </button>
  );
}
