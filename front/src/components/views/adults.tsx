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

export function AdultLeagueDashboardPanel({
  data,
  readOnly = false,
  onCreateSession,
  onMarkPlayer,
  onCreatePayment,
  onPaymentAction,
}: {
  data: AppData;
  readOnly?: boolean;
  onCreateSession: (payload: unknown) => Promise<AttendanceSession>;
  onMarkPlayer: (payload: unknown) => Promise<void>;
  onCreatePayment: (payload: unknown) => void;
  onPaymentAction: (paymentId: number, action: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const adultTeams = data.teams.filter((team) => team.is_active);
  const adultTeamIds = new Set(adultTeams.map((team) => team.id));
  const adultPlayers = data.players.filter((player) => adultTeamIds.has(player.team) && player.is_active);
  const adultCharges = data.charges.filter((charge) => charge.team && adultTeamIds.has(charge.team));
  const adultChargeIds = new Set(adultCharges.map((charge) => charge.id));
  const adultPayments = data.payments.filter((payment) => adultChargeIds.has(payment.charge));
  const adultIncome = adultPayments
    .filter((payment) => payment.status === "registered" || payment.status === "reconciled")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const adultBalance = adultCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const refereeExpenses = data.expenses
    .filter((expense) => expense.category.toLowerCase().includes("arbit"))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const activeTournament = data.tournaments.find((tournament) => tournament.is_active && adultTeams.some((team) => team.tournament === tournament.id)) ?? data.tournaments[0] ?? null;
  const standings = data.standings.filter((row) => !activeTournament || row.tournament === activeTournament.id);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(adultTeams[0]?.id ?? null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [paymentForm, setPaymentForm] = useState({ charge: "", amount: "", method: "cash", channel: "cash_confirmation" });

  const selectedTeam = adultTeams.find((team) => team.id === selectedTeamId) ?? adultTeams[0] ?? null;
  const selectedPlayers = selectedTeam ? adultPlayers.filter((player) => player.team === selectedTeam.id).sort((a, b) => Number(a.jersey_number || 99) - Number(b.jersey_number || 99)) : [];
  const selectedCharges = selectedTeam ? adultCharges.filter((charge) => charge.team === selectedTeam.id && (charge.status === "pending" || charge.status === "partial")) : [];
  const teamSessions = selectedTeam ? data.attendanceSessions.filter((session) => session.session_type === "tournament_match" && session.team === selectedTeam.id) : [];
  const activeSession = teamSessions.find((session) => session.id === activeSessionId) ?? teamSessions[0] ?? null;
  const recordsByPlayer = useMemo(() => {
    const map = new Map<number, PlayerAttendanceRecord>();
    data.playerAttendanceRecords
      .filter((record) => record.session === activeSession?.id)
      .forEach((record) => map.set(record.player, record));
    return map;
  }, [activeSession?.id, data.playerAttendanceRecords]);
  const presentCount = Array.from(recordsByPlayer.values()).filter((record) => record.status === "present").length;

  useEffect(() => {
    if (!selectedTeamId && adultTeams[0]) setSelectedTeamId(adultTeams[0].id);
  }, [adultTeams, selectedTeamId]);

  async function createTeamSession() {
    if (!selectedTeam || !activeTournament) return;
    const session = await onCreateSession({
      site: selectedTeam.site,
      session_type: "tournament_match",
      date: today,
      starts_at: "20:00",
      group_name: selectedTeam.name,
      tournament: selectedTeam.tournament,
      team: selectedTeam.id,
    });
    setActiveSessionId(session.id);
  }

  async function markPlayer(player: Player, status: PlayerAttendanceRecord["status"]) {
    if (!activeSession) return;
    await onMarkPlayer({
      session: activeSession.id,
      player: player.id,
      status,
      override_reason: selectedCharges.length > 0 && status === "present" ? "Jugador adulto asistio con adeudo visible del equipo" : "",
    });
  }

  function selectCharge(chargeId: string) {
    const charge = selectedCharges.find((item) => item.id === Number(chargeId));
    setPaymentForm({ ...paymentForm, charge: chargeId, amount: charge?.balance || "" });
  }

  function changePaymentMethod(method: string) {
    setPaymentForm({
      ...paymentForm,
      method,
      channel: method === "transfer" ? "transfer_clabe" : method === "card" ? "card_terminal" : "cash_confirmation",
    });
  }

  function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentForm.charge) return;
    onCreatePayment({
      charge: Number(paymentForm.charge),
      method: paymentForm.method,
      channel: paymentForm.channel,
      amount: paymentForm.amount,
    });
    setPaymentForm({ ...paymentForm, amount: "" });
  }

  return (
    <section className="grid gap-5 rounded-md border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-blue-700">Operacion adultos</p>
          <h2 className="text-xl font-semibold text-blue-950">Liga adultos</h2>
          <p className="mt-1 text-sm text-blue-800">Equipos de 16 jugadores, representante por equipo, pagos separados y pase de lista por jugador.</p>
        </div>
        <span className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white">Modo azul</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Equipos adultos" value={adultTeams.length} />
        <Metric label="Jugadores adultos" value={adultPlayers.length} helper={`${adultTeams.length * 16} esperados`} />
        <Metric label="Ingresos adultos" value={`$${money(adultIncome)}`} />
        <Metric label="Adeudo adultos" value={`$${money(adultBalance)}`} />
        <Metric label="Arbitraje" value={`$${money(refereeExpenses)}`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="grid gap-5">
          <div className="rounded-md border border-blue-200 bg-white shadow-sm">
            <TableHeader title="Equipos y representantes" count={adultTeams.length} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-blue-100 bg-blue-50 text-xs uppercase text-blue-800">
                  <tr>
                    <th className="px-4 py-3">Equipo</th>
                    <th className="px-4 py-3">Sede</th>
                    <th className="px-4 py-3">Representante</th>
                    <th className="px-4 py-3">Jugadores</th>
                    <th className="px-4 py-3">Adeudo</th>
                    <th className="px-4 py-3">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {adultTeams.slice(0, 18).map((team) => {
                    const playerCount = adultPlayers.filter((player) => player.team === team.id).length;
                    const balance = adultCharges.filter((charge) => charge.team === team.id).reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
                    return (
                      <tr key={team.id} className="border-b border-blue-50">
                        <td className="px-4 py-3 font-medium">{team.name}</td>
                        <td className="px-4 py-3">{team.site_name}</td>
                        <td className="px-4 py-3">{team.representative_name}<br /><span className="text-xs text-zinc-500">{team.representative_phone}</span></td>
                        <td className="px-4 py-3">
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${playerCount === 16 ? "bg-blue-100 text-blue-800" : "bg-amber-50 text-amber-800"}`}>{playerCount}/16</span>
                        </td>
                        <td className="px-4 py-3">${money(balance)}</td>
                        <td className="px-4 py-3">
                <button className="rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => setSelectedTeamId(team.id)}>{readOnly ? "Ver" : "Operar"}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-blue-200 bg-white shadow-sm">
            <div className="border-b border-blue-100 px-4 py-3">
              <p className="text-xs font-semibold uppercase text-blue-700">Tabla de posiciones adultos</p>
              <h3 className="font-semibold">{activeTournament?.name || "Torneo activo"}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-blue-100 bg-blue-50 text-xs uppercase text-blue-800">
                  <tr>
                    <th className="px-4 py-3">Pos</th>
                    <th className="px-4 py-3">Equipo</th>
                    <th className="px-4 py-3">PJ</th>
                    <th className="px-4 py-3">DG</th>
                    <th className="px-4 py-3">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row) => (
                    <tr key={row.team} className={`border-b border-blue-50 transition-all duration-500 ${row.is_leader ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-3"><span className={`inline-grid size-8 place-items-center rounded-full font-semibold ${row.is_leader ? "bg-blue-700 text-white" : "bg-zinc-100"}`}>{row.position}</span></td>
                      <td className="px-4 py-3 font-medium">{row.team_name}{row.is_leader && <span className="ml-2 rounded-md bg-blue-700 px-2 py-1 text-xs text-white">Lider</span>}</td>
                      <td className="px-4 py-3">{row.played}</td>
                      <td className="px-4 py-3">{row.goal_difference > 0 ? "+" : ""}{row.goal_difference}</td>
                      <td className="px-4 py-3 text-lg font-bold">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          {!readOnly && (
          <div className="rounded-md border border-blue-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-blue-950">Cobro por equipo</h3>
            <p className="mt-1 text-sm text-zinc-500">{selectedTeam?.name || "Selecciona equipo"} - representante {selectedTeam?.representative_name}</p>
            <form onSubmit={submitPayment} className="mt-4 grid gap-3">
              <SelectInput label="Cobro programado" value={paymentForm.charge} onChange={(event) => selectCharge(event.target.value)} required>
                <option value="">{selectedCharges.length ? "Seleccionar jornada o torneo" : "Sin cobros pendientes"}</option>
                {selectedCharges.map((charge) => (
                  <option key={charge.id} value={charge.id}>{chargeLabel(charge)} - ${money(charge.balance)}</option>
                ))}
              </SelectInput>
              <SelectInput label="Metodo" value={paymentForm.method} onChange={(event) => changePaymentMethod(event.target.value)}>
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="card">Tarjeta</option>
              </SelectInput>
              <TextInput label="Monto" type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required />
              <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Registrar pago adulto</button>
            </form>
          </div>
          )}

          <div className="rounded-md border border-blue-200 bg-white shadow-sm">
            <div className="border-b border-blue-100 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-blue-950">Pase de lista adultos</h3>
                  <p className="mt-1 text-sm text-zinc-500">{selectedTeam?.name || "Selecciona equipo"} - {presentCount}/{selectedPlayers.length} presentes</p>
                </div>
                {!readOnly && <button className="rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white" onClick={createTeamSession}>Crear partido</button>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {teamSessions.slice(0, 4).map((session) => (
                  <button key={session.id} className={`rounded-md border px-2 py-1 text-xs ${activeSession?.id === session.id ? "border-blue-700 bg-blue-700 text-white" : "border-blue-200 bg-white text-blue-800"}`} onClick={() => setActiveSessionId(session.id)}>
                    {session.date} {session.starts_at?.slice(0, 5) || ""}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[560px] divide-y divide-blue-50 overflow-auto">
              {selectedPlayers.map((player) => {
                const record = recordsByPlayer.get(player.id);
                return (
                  <div key={player.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="flex items-center gap-3">
                      <Avatar name={player.full_name} imageUrl={player.photo_url} />
                      <div>
                        <p className="font-medium">#{player.jersey_number || "-"} {player.full_name}</p>
                        <p className="text-sm text-zinc-500">{player.phone} - {player.email}</p>
                        {record?.had_team_debt_at_capture && <p className="text-xs text-amber-700">Asistio con adeudo visible del equipo.</p>}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <AttendanceButton active={record?.status === "present"} disabled={readOnly || !activeSession} label="Asiste" icon={<Check size={16} />} onClick={() => markPlayer(player, "present")} />
                      <AttendanceButton active={record?.status === "absent"} disabled={readOnly || !activeSession} label="Falta" icon={<X size={16} />} onClick={() => markPlayer(player, "absent")} />
                      <AttendanceButton active={record?.status === "justified"} disabled={readOnly || !activeSession} label="Justif." icon={<ClipboardCheck size={16} />} onClick={() => markPlayer(player, "justified")} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
