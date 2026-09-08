import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
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


export function LoginForm({ onLogin, className = "", variant = "default" }: { onLogin: (token: string, user: User) => void; className?: string; variant?: "default" | "landing" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isLanding = variant === "landing";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "No se pudo iniciar sesión. Revisa tu usuario y contraseña.");
      onLogin(body.token, body.user);
    } catch (err) {
      setError(err instanceof TypeError ? "No pudimos conectar con Futsi. Inténtalo de nuevo en unos momentos." : err instanceof Error ? err.message : "No se pudo iniciar sesión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="login-title" aria-busy={loading} className={`w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 ${isLanding ? "welcome-login-form" : ""} ${className}`} data-testid="login-form">
      {isLanding ? (
        <>
          <p className="welcome-login-eyebrow"><Lock size={12} aria-hidden="true" /> TU ESPACIO EN FUTSI</p>
          <h2 id="login-title" className="welcome-login-heading">Bienvenido a tu equipo.</h2>
          <p className="welcome-login-intro">Inicia sesión para continuar con tu día.</p>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <img className="h-12 w-12 rounded-md object-cover" src="./favicon.png" alt="Futsi" />
          <div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Futsi</p><h1 id="login-title" className="text-xl font-semibold">Iniciar sesión</h1></div>
        </div>
      )}
      <label className={`${isLanding ? "" : "mt-6"} block text-sm font-medium`} htmlFor="username">Usuario</label>
      <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required readOnly={loading} placeholder="Tu nombre de usuario" data-testid="login-username" className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-700" value={username} onChange={(event) => setUsername(event.target.value)} aria-describedby={error ? "login-error" : undefined} />
      <label className="mt-4 block text-sm font-medium" htmlFor="password">Contraseña</label>
      <div className="login-password-wrap relative mt-2">
        <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required readOnly={loading} placeholder="Tu contraseña" data-testid="login-password" className="w-full rounded-md border border-zinc-300 px-3 py-2 pr-12 outline-none focus:border-emerald-700" value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={error ? "login-error" : undefined} />
        <button type="button" className="login-password-toggle absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-controls="password" aria-pressed={showPassword}>
          {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      {error && <p id="login-error" role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <button type="submit" data-testid="login-submit" className={`mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500 ${isLanding ? "welcome-login-submit" : ""}`} disabled={loading}>
        {loading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : null}
        {loading ? "Entrando…" : "Entrar a Futsi"}
        {!loading ? <ArrowRight size={16} aria-hidden="true" /> : null}
      </button>
      {isLanding ? <p className="welcome-login-note"><Shield size={12} aria-hidden="true" /> Acceso para miembros de tu academia</p> : null}
    </form>
  );
}
export function LoginScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-stone-50 px-5 text-zinc-950 dark:bg-zinc-950" data-testid="login-page">
      <LoginForm onLogin={onLogin} />
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
