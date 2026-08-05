export async function stationApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { detail?: string } & T;
  if (!response.ok) throw new Error(payload.detail || `Error HTTP ${response.status}`);
  return payload;
}

export function toQuery(values: Record<string, string | number>) {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();
}
