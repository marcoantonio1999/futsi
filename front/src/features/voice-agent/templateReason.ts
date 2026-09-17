const emptyProviderReasons = new Set([
  "NONE",
  "NULL",
  "N/A",
  "NOT_APPLICABLE",
]);

export function reportedTemplateReason(value: unknown): string {
  const reason = String(value ?? "").trim();
  return reason && !emptyProviderReasons.has(reason.toUpperCase()) ? reason : "";
}
