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
    throw new ApiError(`${detail?.detail ?? "No se pudo completar la accion."} (${path})`, response.status, path);
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
    throw new ApiError(`${detail?.detail ?? "No se pudo procesar el archivo."} (${path})`, response.status, path);
  }
  return response.json();
}

export async function downloadApiFile(path: string, token: string, fallbackName: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new ApiError(`${detail?.detail ?? "No se pudo descargar el archivo."} (${path})`, response.status, path);
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

