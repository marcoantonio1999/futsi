import test from "node:test";
import assert from "node:assert/strict";
import { coachStudents, coachPayrollExpenses, payrollData } from "../src/features/coach/coachWorkspaceModel.ts";

const data = {
  students: [{ id: 1, site: 1, group_name: "A" }, { id: 2, site: 1, group_name: "B" }, { id: 3, site: 2, group_name: "A" }],
  coachWorkLogs: [
    { id: 1, coach: 10, site: 1, work_date: "2026-09-02", hours: "2.50", hourly_rate_snapshot: "80", total_amount: "200.00" },
    { id: 2, coach: 10, site: 2, work_date: "2026-09-03", hours: "1", hourly_rate_snapshot: "100", total_amount: "100.00" },
    { id: 3, coach: 10, site: 1, work_date: "2026-08-20", hours: "3", total_amount: "240.00" },
    { id: 4, coach: 20, site: 1, work_date: "2026-09-04", hours: "2", total_amount: "300.00" },
  ],
  staffPaymentRequests: [
    { id: 1, recipient: 10, site: 1, kind: "coach_payroll", status: "requested", amount: "100.10", requested_payment_date: "2026-09-05" },
    { id: 2, recipient: 10, site: 1, kind: "coach_payroll", status: "accepted", amount: "90.20", requested_payment_date: "2026-09-06", accepted_at: "2026-10-01" },
    { id: 3, recipient: 10, site: 1, kind: "coach_payroll", status: "rejected", amount: "800", requested_payment_date: "2026-09-07" },
    { id: 4, recipient: 10, site: 1, kind: "coach_payroll", status: "canceled", amount: "900", requested_payment_date: "2026-09-08" },
    { id: 5, recipient: 10, site: 1, kind: "referee_payroll", status: "accepted", amount: "700", requested_payment_date: "2026-09-09" },
    { id: 6, recipient: 20, site: 1, kind: "coach_payroll", status: "requested", amount: "200", requested_payment_date: "2026-09-05" },
    { id: 7, recipient: 10, site: 2, kind: "coach_payroll", status: "accepted", amount: "400", requested_payment_date: "2026-08-05" },
  ],
};

test("payroll keeps estimates, pending and accepted separate; excludes canceled/rejected amounts and referee payments", () => {
  const result = payrollData(data, { month: "2026-09", site: "1", coach: "10" });
  assert.equal(result.hours, 2.5);
  assert.equal(result.estimated, 200);
  assert.equal(result.pending, 100.1);
  assert.equal(result.accepted, 90.2);
  assert.equal(result.pendingCount, 1);
  assert.deepEqual(result.requests.map(row => row.id), [4, 3, 2, 1]);
});

test("historical site and snapshot are used even when the current coach rate or site changed", () => {
  const result = payrollData({ ...data, users: [{ id: 10, primary_site: 2, coach_hourly_rate: "250" }] }, { month: "2026-09", site: "1", coach: "10" });
  assert.equal(result.estimated, 200);
  assert.deepEqual(result.logs.map(row => row.id), [1]);
});

test("all-history option includes older logs, both sites and every coach", () => {
  const result = payrollData(data, { month: "", site: "", coach: "" });
  assert.equal(result.hours, 8.5);
  assert.equal(result.estimated, 840);
  assert.equal(result.accepted, 490.2);
  assert.equal(result.pending, 300.1);
});

test("empty periods produce an explicit zero activity state", () => {
  const result = payrollData(data, { month: "2025-01", site: "", coach: "" });
  assert.equal(result.logs.length, 0);
  assert.equal(result.requests.length, 0);
  assert.equal(result.hours + result.estimated + result.accepted + result.pending, 0);
});

test("student assignment respects site and group; an unassigned coach covers no students", () => {
  assert.deepEqual(coachStudents(data, { primary_site: 1, coach_group_name: "A" }).map(row => row.id), [1]);
  assert.deepEqual(coachStudents(data, { primary_site: 1, coach_group_name: "" }).map(row => row.id), [1, 2]);
  assert.deepEqual(coachStudents(data, { primary_site: null, coach_group_name: "" }), []);
});

test("legacy payroll expenses are included once and unrelated expenses are excluded", () => {
  const source = { ...data, staffPaymentRequests: [...data.staffPaymentRequests, { id: 8, kind: "coach_payroll", recipient: 10, expense: 2 }], expenses: [
    { id: 1, category: "Pago a coaches", expense_date: "2026-09-02", site: 1, status: "pending", amount: "1200" },
    { id: 2, category: "Nómina coaches", expense_date: "2026-09-03", site: 1, status: "approved", amount: "900" },
    { id: 3, category: "Arbitraje", expense_date: "2026-09-03", site: 1, status: "approved", amount: "500" },
    { id: 4, category: "Pago a coaches", expense_date: "2026-08-03", site: 1, status: "approved", amount: "700" },
  ] };
  const result = coachPayrollExpenses(source, { month: "2026-09", site: "1", coach: "" });
  assert.deepEqual(result.rows.map(row => row.id), [2, 1]);
  assert.equal(result.approved, 900);
  assert.equal(result.pending, 1200);
  const byCoach = coachPayrollExpenses(source, { month: "2026-09", site: "1", coach: "10" });
  assert.deepEqual(byCoach.rows.map(row => row.id), [2]);
  assert.equal(byCoach.pending, 0, "unlinked legacy expenses must not be attributed to a coach by guessing their name");
});
