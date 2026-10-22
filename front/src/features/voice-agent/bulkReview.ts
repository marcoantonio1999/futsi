import type { FileContact, FileFacets, FileProfile } from './FileContactFilters';

export type RecipientParameters = Record<string, Record<string, string>>;
export type TemplateParameter = { key: string; label: string; contact_name?: boolean };

export const EMPTY_CONTACT_NAME_VALUE = '👋';

export function firstContactName(value: string | undefined): string {
  return value?.trim().split(/\s+/)[0] || '';
}

export function missingRequiredRecipientFields(
  phones: string[],
  parameters: TemplateParameter[],
  values: RecipientParameters,
): number {
  return phones.reduce((total, phone) => total + parameters.filter(parameter => (
    !parameter.contact_name && !values[phone]?.[parameter.key]?.trim()
  )).length, 0);
}

export function recipientPreviewValue(parameter: TemplateParameter, value: string | undefined, index: number): string {
  if (parameter.contact_name) return firstContactName(value) || EMPTY_CONTACT_NAME_VALUE;
  return value?.trim() || parameter.label || `{{${index + 1}}}`;
}

export type BulkReview = {
  phones: string[];
  names?: Record<string, string>;
  sent_history?: Record<string, { sent_at: string }>;
  parameter_values?: RecipientParameters;
  filters?: Record<string, { platform?: string; vacancy_type?: string }>;
  added_filter_options?: { platform: string[]; vacancy_type: string[] };
  count: number;
  duplicates: number;
  invalid: { row: number; value: string; reason: string }[];
  needs_column?: boolean;
  columns?: { index: number; label: string }[];
  contact_ids?: number[];
  needs_review_count?: number;
  unverified_consent_count?: number;
  file_contacts?: FileContact[];
  file_profile?: FileProfile;
  file_facets?: FileFacets;
  file_total?: number;
};

export function normalizeBulkReview(value: Partial<BulkReview> | null | undefined): BulkReview {
  const phones = Array.isArray(value?.phones) ? value.phones : [];
  return {
    ...value,
    phones,
    count: Number.isFinite(value?.count) ? Number(value?.count) : phones.length,
    duplicates: Number.isFinite(value?.duplicates) ? Number(value?.duplicates) : 0,
    invalid: Array.isArray(value?.invalid) ? value.invalid : [],
  };
}

// Phone-based review only (Verónica); directory contact IDs are not used here.
export function excludeBulkPhones(review: BulkReview, excluded: string[]): BulkReview {
  const excludedSet = new Set(excluded);
  const phones = review.phones.filter(phone => !excludedSet.has(phone));
  const keep = <T,>(values: Record<string, T> | undefined) => values &&
    Object.fromEntries(phones.filter(phone => Object.hasOwn(values, phone)).map(phone => [phone, values[phone]]));
  return { ...review, phones, count: phones.length, names: keep(review.names),
    sent_history: keep(review.sent_history), parameter_values: keep(review.parameter_values), filters: keep(review.filters) };
}
