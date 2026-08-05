export const todayLocal = () => new Date().toLocaleDateString("en-CA");
export const currentMonth = () => todayLocal().slice(0, 7);

export function localTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateLabel(value?: string) {
  if (!value) return "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function monthLabel(value: string) {
  const parsed = new Date(`${value}-01T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

export function compactNumber(value: number | undefined) {
  return Number(value || 0).toLocaleString("es-MX");
}

export function currency(value: number | undefined) {
  return Number(value || 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  });
}

export function dateTimeDateLabel(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

export function fileSize(value: number | undefined) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function identityTypeLabel(value?: string) {
  const labels: Record<string, string> = {
    player: "Jugador",
    student: "Alumno",
    coach: "Entrenador",
    staff: "Personal",
  };
  return labels[value || ""] || "Registro";
}

export function initials(name?: string) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

export function normalizeSearch(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}

export function stateLabel(value?: string) {
  const labels: Record<string, string> = {
    stopped: "Detenido",
    starting: "Iniciando",
    loading_model: "Cargando modelo",
    benchmarking: "Midiendo equipo",
    running: "Activo",
    error: "Error",
  };
  return labels[value || ""] || value || "Desconocido";
}
