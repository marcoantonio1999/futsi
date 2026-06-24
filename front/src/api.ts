export const API_URL = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000/api").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
  }
}

function formatApiError(detail: unknown, fallback: string) {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (typeof detail !== "object") return fallback;
  if ("detail" in detail && typeof detail.detail === "string") return detail.detail;
  const rows = Object.entries(detail as Record<string, unknown>).map(([field, value]) => {
    const label = field === "non_field_errors" ? "Formulario" : field.replaceAll("_", " ");
    const message = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : JSON.stringify(value);
    return `${label}: ${message}`;
  });
  return rows.length ? rows.join(" | ") : fallback;
}

export function authHeaders(token: string) {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
}

export async function apiRequest<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(token),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const fallback =
      response.status === 404
        ? "Esta ruta no existe en el backend desplegado. Render probablemente necesita redeploy con el backend mas reciente."
        : "No se pudo completar la accion.";
    throw new ApiError(`${formatApiError(detail, fallback)} (${path})`, response.status, path);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export async function apiFormRequest<T>(path: string, token: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Token ${token}` },
    body: formData,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ApiError(`${formatApiError(detail, "No se pudo procesar el archivo.")} (${path})`, response.status, path);
  }
  return response.json();
}

export function apiFormRequestWithProgress<T>(
  path: string,
  token: string,
  formData: FormData,
  onProgress: (progress: { loaded: number; total: number; percent: number }) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}${path}`);
    request.setRequestHeader("Authorization", `Token ${token}`);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.max(0, Math.min(100, (event.loaded / event.total) * 100)),
      });
    };

    request.onload = () => {
      const parsed = request.responseText ? JSON.parse(request.responseText) : null;
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(`${formatApiError(parsed, "No se pudo procesar el archivo.")} (${path})`, request.status, path));
        return;
      }
      resolve(parsed as T);
    };

    request.onerror = () => reject(new ApiError(`No se pudo conectar con el servidor. (${path})`, 0, path));
    request.send(formData);
  });
}

export async function downloadApiFile(path: string, token: string, fallbackName: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ApiError(`${formatApiError(detail, "No se pudo descargar el archivo.")} (${path})`, response.status, path);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] ?? fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

