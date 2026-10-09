import { apiRequest } from "../../api";

export type ContactAudit = { total: number; categories: Record<string, number>; relationships: Array<{ label: string; count: number }> };
type Directory = { total: number; dataset_total: number; facets: { relationship?: string[] } };
type Channel = { business_address: string; site: number | null };

export function classificationGroup(label: string): string {
  const value = label.trim().toLocaleLowerCase("es-MX");
  if (!value || value === "sin clasificar") return "unclassified";
  if (["prospecto", "lista de espera"].includes(value)) return "prospect";
  if (["alumno confirmado", "participante confirmado", "familia / cliente", "participante adulto"].includes(value)) return "current_client";
  if (["indeterminado", "alumno probable", "participante probable", "mixto", "sin texto"].includes(value)) return "ambiguous";
  return "other";
}

// Compatibility with the already deployed directory API. Only counts are used;
// no messages are sent and no classifications or contact records are changed.
export async function loadExistingContactAudit(token: string, scopeQuery: string, signal: AbortSignal): Promise<ContactAudit> {
  const get = <T,>(path: string) => apiRequest<T>(path, token, { signal });
  const [visible, directory] = await Promise.all([
    get<Channel[]>("/whatsapp-conversations/channels/"),
    get<{ channels: Array<{ channel: string; contact_directory?: string }> }>("/whatsapp-bulk/channels/"),
  ]);
  const scope = new URLSearchParams(scopeQuery);
  const address = scope.get("business_address");
  const site = scope.get("site");
  const allowed = new Set(visible.filter(row => (!address || row.business_address === address)
    && (!site || (site === "unassigned" ? row.site == null : row.site === Number(site)))).map(row => row.business_address));
  const channels = directory.channels.filter(row => row.contact_directory && allowed.has(row.channel));
  const relationships = new Map<string, number>();
  let total = 0;
  for (const channel of channels) {
    const query = (relationship?: string) => "/whatsapp-bulk/contacts/?" + new URLSearchParams({
      channel: channel.channel, outreach: "all", limit: "1", ...(relationship ? { relationship } : {}),
    });
    const base = await get<Directory>(query());
    const labels = [...new Set(base.facets.relationship || [])];
    let counted = 0;
    // Bound concurrency to avoid a burst of requests against the live service.
    for (let index = 0; index < labels.length; index += 3) {
      const counts = await Promise.all(labels.slice(index, index + 3).map(async label => ({ label, value: (await get<Directory>(query(label))).total })));
      for (const { label, value } of counts) {
        counted += value;
        relationships.set(label, (relationships.get(label) || 0) + value);
      }
    }
    if (counted > base.dataset_total) throw new Error("La base cambió durante la consulta. Actualiza la página.");
    const blank = base.dataset_total - counted;
    if (blank) relationships.set("Sin clasificar", (relationships.get("Sin clasificar") || 0) + blank);
    total += base.dataset_total;
  }
  if (!channels.length) throw new Error("No hay un directorio analizado disponible para este filtro.");
  const categories: Record<string, number> = { prospect: 0, current_client: 0, ambiguous: 0, unclassified: 0, other: 0 };
  for (const [label, count] of relationships) categories[classificationGroup(label)] += count;
  return { total, categories, relationships: [...relationships].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) };
}
