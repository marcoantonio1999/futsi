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
import { Metric } from "../cards/Metric";
import { CollectionFunnel } from "../charts/CollectionFunnel";
import { FinancialAxisChart } from "../charts/FinancialAxisChart";
import { FinancialComboChart } from "../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../charts/StudentStatusDonut";
import { API_URL } from "../../api";
import { roleLabels, statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../types";

import {
  Avatar,
  AttendanceButton,
  FaceAttendanceCard,
  InfoChip,
  InvoiceGenerator,
  InvoiceRows,
  SelectInput,
  SimpleList,
  StaffPaymentInbox,
  StatusPill,
  TableHeader,
  TextInput,
  average,
  calculateCashBySite,
  calculateMonthlyTicketAverage,
  chargeLabel,
  chargeStatusLabel,
  collectionProgress,
  dateDay,
  dateMonthKey,
  expenseStatusLabel,
  exportAccountingWorkbook,
  cashMovementLabel,
  methodLabel,
  monthLabelFromKey,
  normalizeText,
  paymentMethodLabel,
  paymentMonthKey,
  paymentPayerKey,
  paymentStatusLabel,
  staffPaymentKindLabel,
  staffPaymentStatusLabel,
  sumAccountingRows,
} from "./shared";


export function HistoricalImportsPanel({
  data,
  onUpload,
  onCommit,
}: {
  data: AppData;
  onUpload: (formData: FormData) => Promise<HistoricalImport>;
  onCommit: (importId: number, payload: unknown) => Promise<HistoricalImport>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [signatureRole, setSignatureRole] = useState("Administrador");
  const [notes, setNotes] = useState("");
  const [selectedImportId, setSelectedImportId] = useState<number | null>(data.historicalImports[0]?.id ?? null);
  const selectedImport = data.historicalImports.find((item) => item.id === selectedImportId) ?? data.historicalImports[0] ?? null;

  useEffect(() => {
    if (!selectedImportId && data.historicalImports[0]) setSelectedImportId(data.historicalImports[0].id);
  }, [data.historicalImports, selectedImportId]);

  async function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    if (password) formData.append("password", password);
    const result = await onUpload(formData);
    setSelectedImportId(result.id);
  }

  async function submitCommit(event: FormEvent) {
    event.preventDefault();
    if (!selectedImport) return;
    const result = await onCommit(selectedImport.id, {
      signature_name: signatureName,
      signature_role: signatureRole,
      notes,
    });
    setSelectedImportId(result.id);
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="grid gap-5">
        <form onSubmit={submitUpload} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Upload size={16} /> Subir Excel historico</h2>
          <p className="mt-1 text-sm text-zinc-500">Admin/contador pueden previsualizar datos cerrados antes de firmarlos.</p>
          <div className="mt-4 grid gap-3">
            <input className="rounded-md border border-zinc-300 px-3 py-2 text-sm" type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <TextInput label="Password del Excel" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" data-testid="historical-preview-submit">Analizar archivo</button>
          </div>
        </form>

        <form onSubmit={submitCommit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Firma de carga historica</h2>
          <div className="mt-4 grid gap-3">
            <TextInput label="Nombre de quien firma" required value={signatureName} onChange={(event) => setSignatureName(event.target.value)} />
            <TextInput label="Rol" required value={signatureRole} onChange={(event) => setSignatureRole(event.target.value)} />
            <TextInput label="Notas" value={notes} onChange={(event) => setNotes(event.target.value)} />
            <button className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!selectedImport || selectedImport.status !== "draft"}>Firmar y cargar</button>
          </div>
        </form>
      </div>

      <div className="grid gap-5">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Archivos historicos" count={data.historicalImports.length} />
          <div className="divide-y divide-zinc-100">
            {data.historicalImports.map((item) => (
              <button key={item.id} className={`block w-full px-4 py-3 text-left text-sm ${selectedImport?.id === item.id ? "bg-zinc-950 text-white" : "bg-white"}`} onClick={() => setSelectedImportId(item.id)}>
                <span className="block font-medium">{item.original_filename}</span>
                <span className={selectedImport?.id === item.id ? "text-zinc-200" : "text-zinc-500"}>{item.status} - {item.row_count ?? item.rows.length} filas</span>
              </button>
            ))}
            {data.historicalImports.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin archivos analizados.</p>}
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Preview de filas" count={selectedImport?.rows.length ?? 0} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr><th className="px-4 py-3">Hoja</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Sede</th><th className="px-4 py-3">Concepto</th><th className="px-4 py-3">Monto</th><th className="px-4 py-3">Estado</th></tr>
              </thead>
              <tbody>
                {(selectedImport?.rows ?? []).slice(0, 80).map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3">{row.sheet_name}</td>
                    <td className="px-4 py-3">{row.row_type}</td>
                    <td className="px-4 py-3">{row.site_name || row.site_name_raw}</td>
                    <td className="px-4 py-3">{row.concept}</td>
                    <td className="px-4 py-3">${money(row.amount)}</td>
                    <td className="px-4 py-3"><StatusPill label={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
