import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Upload,
  Shield,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Metric } from "../../cards/Metric";
import { CollectionFunnel } from "../../charts/CollectionFunnel";
import { FinancialAxisChart } from "../../charts/FinancialAxisChart";
import { FinancialComboChart } from "../../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../../charts/StudentStatusDonut";
import { API_URL } from "../../../api";
import { roleLabels, statusLabels } from "../../../appState";
import { money } from "../../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../../types";


export function exportAccountingWorkbook(data: AppData) {
  const xmlEscape = (value: string | number | null | undefined) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const cell = (value: string | number | null | undefined, type: "String" | "Number" = "String") =>
    `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
  const row = (values: Array<string | number | null | undefined>, numericColumns: number[] = []) =>
    `<Row>${values.map((value, index) => cell(value, numericColumns.includes(index) ? "Number" : "String")).join("")}</Row>`;
  const sheet = (name: string, headers: string[], rows: Array<Array<string | number | null | undefined>>, numericColumns: number[] = []) => `
    <Worksheet ss:Name="${xmlEscape(name).slice(0, 31)}">
      <Table>
        ${row(headers)}
        ${rows.map((values) => row(values, numericColumns)).join("")}
      </Table>
    </Worksheet>`;

  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const siteSummary = data.sites.map((site) => {
    const charges = data.charges.filter((charge) => charge.site === site.id);
    const chargeIds = new Set(charges.map((charge) => charge.id));
    const ingresos = confirmedPayments
      .filter((payment) => payment.charge && chargeIds.has(payment.charge))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const egresos = data.expenses
      .filter((expense) => expense.site === site.id && expense.status === "approved")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const pendiente = charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
    return [site.name, ingresos, egresos, ingresos - egresos, pendiente, charges.length];
  });

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  </Styles>
  ${sheet("Resumen", ["Sede", "Ingresos", "Egresos", "Utilidad", "Por cobrar", "Cargos"], siteSummary, [1, 2, 3, 4, 5])}
  ${sheet("Pagos", ["ID", "Cliente", "Concepto", "Metodo", "Canal", "Estado", "Monto", "Pagado", "Confirmado", "Referencia"], data.payments.map((payment) => [
    payment.id,
    payment.student_name || payment.team_name || "",
    payment.charge_concept || "",
    paymentMethodLabel(payment.method),
    payment.channel,
    paymentStatusLabel(payment.status),
    Number(payment.amount || 0),
    payment.paid_at,
    payment.confirmed_at || "",
    payment.reference,
  ]), [0, 6])}
  ${sheet("Cargos", ["ID", "Sede", "Cliente", "Concepto", "Descripcion", "Monto", "Pagado", "Descuento", "Saldo", "Vencimiento", "Estado"], data.charges.map((charge) => [
    charge.id,
    charge.site_name || "",
    charge.student_name || charge.team_name || "",
    charge.concept,
    charge.description,
    Number(charge.amount || 0),
    Number(charge.paid_amount || 0),
    Number(charge.discount_amount || 0),
    Number(charge.balance || 0),
    charge.due_date || "",
    chargeStatusLabel(charge.status),
  ]), [0, 5, 6, 7, 8])}
  ${sheet("Gastos", ["ID", "Sede", "Categoria", "Descripcion", "Proveedor", "Monto", "Fecha", "Estado", "Capturo", "Aprobo"], data.expenses.map((expense) => [
    expense.id,
    expense.site_name || "",
    expense.category,
    expense.description,
    expense.provider_name,
    Number(expense.amount || 0),
    expense.expense_date,
    expenseStatusLabel(expense.status),
    expense.captured_by_username || "",
    expense.approved_by_username || "",
  ]), [0, 5])}
  ${sheet("Descuentos", ["ID", "Cliente", "Cargo", "Motivo", "Monto", "Estado", "Solicito", "Aprobo"], data.discounts.map((discount) => [
    discount.id,
    discount.student_name || "",
    discount.charge_concept || "",
    discount.reason,
    Number(discount.amount || 0),
    discount.status,
    discount.requested_by_username || "",
    discount.approved_by_username || "",
  ]), [0, 4])}
  ${sheet("Asistencia con adeudo", ["ID", "Alumno", "Estado", "Adeudo al capturar", "Motivo"], data.attendanceRecords.filter((record) => record.had_debt_at_capture).map((record) => [
    record.id,
    record.student_name || "",
    record.status,
    record.had_debt_at_capture ? "Si" : "No",
    record.override_reason,
  ]), [0])}
</Workbook>`;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reporte-contable-futsi-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

