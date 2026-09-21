export type RecentWhatsAppTemplate = {
  business_address: string;
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason: string;
  created_at: string;
  components: Array<{ type: string; format: string; text: string; buttons: Array<{ type: string; text: string }> }>;
};

const storageKey = "futsi-recent-whatsapp-templates";
const lifetime = 15 * 60 * 1000;

function readRecentTemplates() {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as RecentWhatsAppTemplate[] : [];
  } catch {
    return [];
  }
}

function writeRecentTemplates(templates: RecentWhatsAppTemplate[]) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(templates.slice(0, 20)));
  } catch {
    // The provider catalog remains authoritative when browser storage is unavailable.
  }
}

export function rememberRecentWhatsAppTemplate(template: RecentWhatsAppTemplate) {
  const key = `${template.business_address}:${template.name}:${template.language}`;
  const previous = readRecentTemplates().filter(item => `${item.business_address}:${item.name}:${item.language}` !== key);
  writeRecentTemplates([template, ...previous]);
}

export function recentWhatsAppTemplatesFor(
  businessAddress: string,
  remoteTemplates: Array<{ name: string; language: string }> = [],
) {
  const now = Date.now();
  const remoteKeys = new Set(remoteTemplates.map(item => `${item.name}:${item.language}`));
  const all = readRecentTemplates();
  const active = all.filter(item => {
    const createdAt = new Date(item.created_at).getTime();
    const expired = !Number.isFinite(createdAt) || now - createdAt > lifetime;
    const synchronized = item.business_address === businessAddress && remoteKeys.has(`${item.name}:${item.language}`);
    return !expired && !synchronized;
  });
  if (active.length !== all.length) writeRecentTemplates(active);
  return active.filter(item => item.business_address === businessAddress);
}
