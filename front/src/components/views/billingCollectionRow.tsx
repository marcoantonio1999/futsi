import type React from "react";
import type { Charge } from "../../types";
import { money } from "../../utils/format";
import { chargeStatusLabel, StatusPill } from "./shared";

export function getChargeDueBucket(charge: Charge) {
  if (charge.status === "paid" || charge.status === "canceled") return charge.status;
  if (!charge.due_date) return "without_due_date";
  const todayDate = new Date(new Date().toISOString().slice(0, 10));
  const dueDate = new Date(charge.due_date);
  const days = Math.round((dueDate.getTime() - todayDate.getTime()) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 2) return "due_soon";
  return "scheduled";
}

export function dueLabel(charge: Charge) {
  const bucket = charge.due_bucket || getChargeDueBucket(charge);
  if (charge.status === "paid") return "Pagado";
  if (charge.status === "canceled") return "Cancelado";
  if (!charge.due_date) return "Sin fecha";
  const days = charge.due_in_days ?? Math.round((new Date(charge.due_date).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  if (bucket === "overdue") return `Vencido hace ${Math.abs(days)} dia(s)`;
  if (bucket === "due_soon") return days === 0 ? "Vence hoy" : `Vence en ${days} dia(s)`;
  return `Vence ${charge.due_date}`;
}

export function dueTone(charge: Charge) {
  const bucket = charge.due_bucket || getChargeDueBucket(charge);
  if (bucket === "overdue") return "bg-red-50 text-red-700";
  if (bucket === "due_soon") return "bg-amber-50 text-amber-800";
  if (charge.status === "paid") return "bg-emerald-50 text-emerald-800";
  return "bg-zinc-100 text-zinc-600";
}

export function chargeSubject(charge: Charge) {
  return charge.student_name || charge.team_name || "Cliente";
}

export const billingHeaderGridClass = "hidden grid-cols-[1.3fr_1fr_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase text-zinc-500 xl:grid";
const rowGridClass = "grid min-w-0 gap-3 px-4 py-4 xl:grid-cols-[1.3fr_1fr_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr] xl:items-center";

export function BillingCollectionRow({
  charge,
  selectedChargeId,
  onSelect,
  renderSelectedActions,
}: {
  charge: Charge;
  selectedChargeId: number | null;
  onSelect: (charge: Charge) => void;
  renderSelectedActions: () => React.ReactNode;
}) {
  return (
    <div>
      <div
        data-testid="cashier-charge-row"
        className={`${rowGridClass} text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900 ${selectedChargeId === charge.id ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}
        onClick={() => onSelect(charge)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onSelect(charge);
        }}
        role="button"
        tabIndex={0}
      >
        <div className="min-w-0">
          <p className="break-words font-semibold">{chargeSubject(charge)}</p>
          <p className="mt-1 text-sm text-zinc-500">{charge.payer_name || "Sin pagador"} {charge.payer_phone ? `- ${charge.payer_phone}` : ""}</p>
          <p className="mt-1 text-xs text-zinc-400">{charge.site_name}</p>
        </div>
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{charge.concept}</p>
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{charge.description || "Sin detalle"}</p>
        </div>
        <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${dueTone(charge)}`}>{dueLabel(charge)}</span>
        <p className="text-sm">${money(charge.amount)}</p>
        <p className="text-sm">${money(charge.paid_amount || 0)}</p>
        <p className="text-sm font-semibold">${money(charge.balance)}</p>
        <div className="flex flex-wrap gap-2">
          <StatusPill label={chargeStatusLabel(charge.status)} />
          {charge.status === "partial" && <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Pago parcial</span>}
          {charge.schedule_type && charge.schedule_type !== "one_time" && (
            <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
              {charge.schedule_type === "monthly" ? "Mensual" : charge.schedule_type === "weekly" ? "Semanal" : "Torneo"}
            </span>
          )}
        </div>
      </div>
      {selectedChargeId === charge.id && <div className="px-4 pb-4">{renderSelectedActions()}</div>}
    </div>
  );
}

export function BillingDueNotices({ charges }: { charges: Charge[] }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">Avisos de vencimiento simulados</h2>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{charges.length}</span>
      </div>
      <div className="divide-y divide-zinc-100">
        {charges.slice(0, 8).map((charge) => (
          <div key={charge.id} className="px-4 py-3">
            <p className="font-medium">{chargeSubject(charge)} - ${money(charge.balance)}</p>
            <p className="mt-1 text-sm text-zinc-500">{charge.customer_notice || dueLabel(charge)}</p>
            <p className="mt-1 text-xs text-zinc-400">Simulado: WhatsApp/SMS a {charge.payer_phone || "telefono no registrado"}</p>
          </div>
        ))}
        {charges.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin avisos por vencer en los proximos 2 dias.</p>}
      </div>
    </div>
  );
}
