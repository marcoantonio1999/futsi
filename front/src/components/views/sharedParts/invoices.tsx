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
import { SelectInput } from "./metrics";


export function InvoiceRows({ invoices, onDownloadFile }: { invoices: Invoice[]; onDownloadFile: (path: string, filename: string) => void }) {
  return (
    <div className="divide-y divide-zinc-100">
      {invoices.map((invoice) => (
        <div key={invoice.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="font-medium">{invoice.recipient_name} - ${money(invoice.total)}</p>
            <p className="mt-1 text-sm text-zinc-500">
              {invoice.kind === "income" ? "Ingreso" : "Egreso"} - {invoice.concept} - UUID {invoice.uuid}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium" onClick={() => onDownloadFile(`/invoices/${invoice.id}/pdf/`, `factura-${invoice.uuid}.pdf`)}>
              PDF
            </button>
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium" onClick={() => onDownloadFile(`/invoices/${invoice.id}/xml/`, `factura-${invoice.uuid}.xml`)}>
              XML
            </button>
          </div>
        </div>
      ))}
      {invoices.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin facturas simuladas.</p>}
    </div>
  );
}

export function InvoicesPanel({ invoices, onDownloadFile }: { invoices: Invoice[]; onDownloadFile: (path: string, filename: string) => void }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Facturas disponibles" count={invoices.length} />
      <InvoiceRows invoices={invoices} onDownloadFile={onDownloadFile} />
    </div>
  );
}

export function InvoiceGenerator({ data, onCreateInvoice }: { data: AppData; onCreateInvoice: (payload: unknown) => void }) {
  const [sourceType, setSourceType] = useState<"charge" | "payment" | "expense">("charge");
  const [sourceId, setSourceId] = useState("");
  const options = sourceType === "expense" ? data.expenses : sourceType === "payment" ? data.payments : data.charges;

  useEffect(() => {
    setSourceId(options[0]?.id ? String(options[0].id) : "");
  }, [sourceType, options.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!sourceId) return;
    onCreateInvoice({ source_type: sourceType, source_id: Number(sourceId) });
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <FileText size={16} /> PAC simulado
      </h2>
      <p className="mt-1 text-sm text-zinc-500">Genera PDF, XML y UUID demo; queda guardado en la base de datos.</p>
      <div className="mt-4 grid gap-3">
        <SelectInput label="Tipo" value={sourceType} onChange={(event) => setSourceType(event.target.value as "charge" | "payment" | "expense")}>
          <option value="charge">Alumno / cargo</option>
          <option value="payment">Alumno / pago</option>
          <option value="expense">Gasto</option>
        </SelectInput>
        <SelectInput label="Registro" required value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Seleccionar</option>
          {options.map((item: Charge | Payment | Expense) => {
            const label =
              sourceType === "expense"
                ? `${(item as Expense).provider_name || "Proveedor"} - ${(item as Expense).description} - $${money((item as Expense).amount)}`
                : sourceType === "payment"
                  ? `${(item as Payment).student_name || "Cliente"} - ${(item as Payment).charge_concept || "Pago"} - $${money((item as Payment).amount)}`
                  : `${(item as Charge).student_name || "Cliente"} - ${(item as Charge).concept} - $${money((item as Charge).amount)}`;
            return (
              <option key={item.id} value={item.id}>
                {label}
              </option>
            );
          })}
        </SelectInput>
        <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" data-testid="invoice-generate-submit">Generar factura simulada</button>
      </div>
    </form>
  );
}
