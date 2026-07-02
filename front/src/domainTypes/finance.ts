
export type ChargeStatus = "pending" | "partial" | "paid" | "canceled";
export type PaymentMethod = "cash" | "transfer" | "card" | "courtesy";
export type PaymentStatus = "processing" | "awaiting_confirmation" | "registered" | "reconciled" | "canceled" | "expired";
export type DiscountStatus = "requested" | "approved" | "rejected" | "canceled";

export type Charge = {
  id: number;
  site: number;
  site_name?: string;
  student: number | null;
  student_name?: string;
  team: number | null;
  team_name?: string;
  tournament_registration?: number | null;
  tournament_registration_name?: string;
  jornada_number?: number | null;
  concept: string;
  description: string;
  amount: string;
  due_date: string | null;
  status: ChargeStatus;
  paid_amount: string;
  discount_amount: string;
  balance: string;
  due_in_days?: number | null;
  due_bucket?: "overdue" | "due_soon" | "scheduled" | "paid" | "canceled" | "without_due_date";
  customer_notice?: string;
  payer_name?: string;
  payer_phone?: string;
  schedule_type?: "monthly" | "weekly" | "tournament" | "one_time";
};

export type Payment = {
  id: number;
  site?: number;
  site_name?: string;
  charge: number | null;
  student: number | null;
  student_name?: string;
  team_name?: string;
  charge_concept?: string;
  method: PaymentMethod;
  channel: string;
  status: PaymentStatus;
  amount: string;
  paid_at: string;
  confirmed_at: string | null;
  expires_at: string | null;
  reference: string;
  tracking_key: string;
  payment_url: string;
  notes: string;
  received_by_username?: string;
};

export type Discount = {
  id: number;
  charge: number | null;
  student: number | null;
  student_name?: string;
  charge_concept?: string;
  reason: string;
  amount: string;
  status: DiscountStatus;
  requested_by_username?: string;
  approved_by_username?: string;
  created_at?: string;
  approved_at?: string | null;
};

export type ExpenseStatus = "pending" | "approved" | "rejected" | "canceled";

export type Expense = {
  id: number;
  site: number;
  site_name?: string;
  category: string;
  description: string;
  amount: string;
  expense_date: string;
  provider_name: string;
  evidence_file: string;
  status: ExpenseStatus;
  captured_by_username?: string;
  approved_by_username?: string;
};

export type StaffPaymentKind = "admin_payroll" | "coach_payroll" | "referee_payroll" | "other_staff_payment";
export type StaffPaymentStatus = "requested" | "accepted" | "rejected" | "canceled";

export type StaffPaymentRequest = {
  id: number;
  site: number;
  site_name?: string;
  recipient: number;
  recipient_username?: string;
  recipient_name?: string;
  kind: StaffPaymentKind;
  amount: string;
  requested_payment_date: string;
  description: string;
  payment_method: string;
  status: StaffPaymentStatus;
  requested_by_username?: string;
  accepted_at: string | null;
  response_notes: string;
  expense: number | null;
};

export type CashMovementType = "cash_in" | "cash_out" | "vault_transfer" | "adjustment";

export type CashMovement = {
  id: number;
  site: number;
  site_name?: string;
  movement_type: CashMovementType;
  amount: string;
  movement_date: string;
  reason: string;
  responsible: number;
  responsible_username?: string;
  responsible_name?: string;
  created_by_username?: string;
  staff_payment_request: number | null;
  notes: string;
};

export type CoachWorkLog = {
  id: number;
  coach: number;
  coach_username?: string;
  coach_name?: string;
  site: number;
  site_name?: string;
  group_name: string;
  work_date: string;
  hours: string;
  activity: string;
  notes: string;
  hourly_rate_snapshot: string;
  total_amount: string;
};

export type Invoice = {
  id: number;
  uuid: string;
  kind: "income" | "expense";
  status: "issued" | "canceled";
  site: number | null;
  site_name?: string;
  student: number | null;
  student_name?: string;
  guardian: number | null;
  guardian_name?: string;
  coach: number | null;
  coach_name?: string;
  charge: number | null;
  charge_concept?: string;
  payment: number | null;
  expense: number | null;
  expense_description?: string;
  recipient_name: string;
  recipient_tax_id: string;
  recipient_email: string;
  concept: string;
  subtotal: string;
  tax: string;
  total: string;
  issued_at: string;
  pdf_url: string;
  xml_url: string;
};
