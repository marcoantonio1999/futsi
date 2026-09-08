import type { AppData, User } from "../../types";

export type CoachesSection = "overview" | "create" | "payroll";
export const coachSections: { key: CoachesSection; label: string }[] = [
  { key: "overview", label: "Resumen de coaches" },
  { key: "create", label: "Nuevo coach" },
  { key: "payroll", label: "Nómina y horas" },
];

export const coachName = (user: User) => `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username;
export function coachStudents(data: AppData, coach: User) {
  if (!coach.primary_site) return [];
  return data.students.filter(student => student.site === coach.primary_site && (!coach.coach_group_name || student.group_name === coach.coach_group_name));
}

export function payrollData(data: AppData, filters: { month: string; site: string; coach: string }) {
  const logs = data.coachWorkLogs.filter(log => (!filters.month || log.work_date.startsWith(filters.month)) && (!filters.site || String(log.site) === filters.site) && (!filters.coach || String(log.coach) === filters.coach));
  const requests = data.staffPaymentRequests.filter(request => request.kind === "coach_payroll" && (!filters.month || request.requested_payment_date.startsWith(filters.month)) && (!filters.site || String(request.site) === filters.site) && (!filters.coach || String(request.recipient) === filters.coach));
  const total = (status: string) => requests.filter(request => request.status === status).reduce((sum, request) => sum + Math.round(Number(request.amount) * 100), 0) / 100;
  return {
    logs: [...logs].sort((a, b) => b.work_date.localeCompare(a.work_date) || b.id - a.id),
    requests: [...requests].sort((a, b) => b.requested_payment_date.localeCompare(a.requested_payment_date) || b.id - a.id),
    hours: logs.reduce((sum, log) => sum + Number(log.hours), 0),
    estimated: logs.reduce((sum, log) => sum + Math.round(Number(log.total_amount) * 100), 0) / 100,
    pending: total("requested"), accepted: total("accepted"),
    pendingCount: requests.filter(request => request.status === "requested").length,
  };
}

export function coachPayrollExpenses(data: AppData, filters: { month: string; site: string; coach: string }) {
  const linked = new Map(data.staffPaymentRequests.filter(request => request.kind === "coach_payroll" && request.expense).map(request => [request.expense, request]));
  const rows = data.expenses.filter(expense => {
    const request = linked.get(expense.id);
    const payrollCategory = /\bcoaches?\b/i.test(expense.category);
    return (request || payrollCategory) && (!filters.month || expense.expense_date.startsWith(filters.month)) && (!filters.site || String(expense.site) === filters.site) && (!filters.coach || String(request?.recipient) === filters.coach);
  }).sort((a, b) => b.expense_date.localeCompare(a.expense_date) || b.id - a.id);
  const sum = (status: string) => rows.filter(expense => expense.status === status).reduce((total, expense) => total + Math.round(Number(expense.amount) * 100), 0) / 100;
  return { rows, approved: sum("approved"), pending: sum("pending"), linked };
}
