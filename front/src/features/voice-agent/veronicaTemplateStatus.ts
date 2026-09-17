export type TemplateStatusTone = "approved" | "pending" | "rejected" | "inactive";

const templateStatuses: Record<string, { label: string; tone: TemplateStatusTone }> = {
  APPROVED: { label: "Aprobada", tone: "approved" },
  PENDING: { label: "Pendiente", tone: "pending" },
  IN_APPEAL: { label: "En revisión", tone: "pending" },
  REJECTED: { label: "Rechazada", tone: "rejected" },
  PAUSED: { label: "Pausada", tone: "inactive" },
  DISABLED: { label: "Deshabilitada", tone: "inactive" },
  DELETED: { label: "Eliminada", tone: "inactive" },
  PENDING_DELETION: { label: "Pendiente de eliminación", tone: "inactive" },
};

export function templateStatusMeta(status?: string) {
  const normalized = String(status || "").trim().toUpperCase();
  return templateStatuses[normalized] || {
    label: normalized ? normalized.replaceAll("_", " ") : "Estado desconocido",
    tone: "inactive" as const,
  };
}
