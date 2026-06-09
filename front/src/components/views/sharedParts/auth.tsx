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


export function LoginScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin12345");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "No se pudo iniciar sesion.");
      onLogin(body.token, body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-stone-50 px-5 text-zinc-950" data-testid="login-page">
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm" data-testid="login-form">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-emerald-700 text-white">
            <Shield size={20} />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-700">Futsi Mini ERP</p>
            <h1 className="text-xl font-semibold">Acceso operativo</h1>
          </div>
        </div>

        <label className="mt-6 block text-sm font-medium" htmlFor="username">
          Usuario
        </label>
        <input
          id="username"
          data-testid="login-username"
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-700"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          data-testid="login-password"
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-700"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          data-testid="login-submit"
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          disabled={loading}
        >
          <Shield size={16} />
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const isDark = theme === "dark";
  return (
    <button
      data-testid="theme-toggle"
      className="theme-toggle fixed bottom-4 right-4 z-[1200] grid size-11 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-800 shadow-lg transition hover:bg-zinc-50"
      onClick={onToggle}
      type="button"
      title={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

