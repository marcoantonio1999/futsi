import type { FileContact, FileFacets, FileProfile } from './FileContactFilters';

export type RecipientParameters = Record<string, Record<string, string>>;

export type BulkReview = {
  phones: string[];
  names?: Record<string, string>;
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
