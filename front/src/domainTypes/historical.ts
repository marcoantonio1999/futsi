
export type FaceRecognitionResponse = {
  attempt: {
    id: number;
    student: number | null;
    student_name?: string;
    matched: boolean;
    confidence: string;
    engine: string;
    notes: string;
  };
  attendance: AttendanceRecord | null;
};

export type HistoricalImportRow = {
  id: number;
  row_type: "income" | "expense" | "discrepancy";
  sheet_name: string;
  source_row: number;
  month_label: string;
  site: number | null;
  site_name?: string;
  site_name_raw: string;
  concept_code: string;
  concept: string;
  amount: string;
  record_date: string | null;
  status: "pending" | "committed" | "skipped" | "error";
  target_table: string;
  target_id: string;
  error: string;
};

export type HistoricalImport = {
  id: number;
  original_filename: string;
  status: "draft" | "committed" | "canceled";
  uploaded_by_username?: string;
  committed_by_username?: string;
  committed_at: string | null;
  signature_name: string;
  signature_role: string;
  source_password_used: boolean;
  notes: string;
  summary: Record<string, string | number>;
  row_count?: number;
  rows: HistoricalImportRow[];
};

export type HistoricalDiscrepancyItem = {
  id: string;
  source: "historical" | "platform";
  site_id: number | null;
  site_name: string;
  month: string;
  student_name: string;
  guardian_name: string;
  phone: string;
  category: string;
  classes_attended: number;
  folio: string;
  expected_amount: string;
  paid_amount: string;
  missing_amount: string;
  discrepancy_type: string;
  severity: "high" | "medium" | "low";
  status: string;
  source_file: string;
  source_row: number;
  observations: string;
};

export type HistoricalDiscrepancySummary = {
  site_name: string;
  month: string;
  total_cases: number;
  high_risk: number;
  missing_amount: string;
  classes_attended: number;
  missing_folio: number;
  no_payment: number;
  partial_payment: number;
};

export type HistoricalDiscrepancyReport = {
  summary: HistoricalDiscrepancySummary[];
  items: HistoricalDiscrepancyItem[];
  current_platform_items: HistoricalDiscrepancyItem[];
  totals: {
    historical_cases: number;
    current_platform_cases: number;
    high_risk: number;
    estimated_missing_amount: string;
  };
};
