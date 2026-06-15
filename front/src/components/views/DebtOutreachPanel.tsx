import { useState } from "react";
import { Eye, MessageCircle, Phone } from "lucide-react";
import { money } from "../../utils/format";
import {
  cleanPhone,
  daysSinceSent,
  defaultOutreach,
  formatDate,
  outreachClass,
  outreachLabel,
  whatsappMessage,
  type DebtRow,
  type OutreachState,
} from "./debtsLogic";

export function DebtOutreachPanel({ debts, today }: { debts: DebtRow[]; today: Date }) {
  const [outreachByCharge, setOutreachByCharge] = useState<Record<number, OutreachState>>({});
  const rows = debts.slice(0, 12);
  const outreachFor = (debt: DebtRow) => outreachByCharge[debt.charge.id] || defaultOutreach(debt, today);
  const pendingCalls = rows.filter((debt) => {
    const outreach = outreachFor(debt);
    return Boolean(outreach.sentAt && !outreach.seenAt && !outreach.calledAt && daysSinceSent(outreach, today) >= 3);
  });

  function updateOutreach(debt: DebtRow, next: Partial<OutreachState>) {
    const current = outreachFor(debt);
    setOutreachByCharge((state) => ({
      ...state,
      [debt.charge.id]: { ...current, ...next },
    }));
  }

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-emerald-700">Seguimiento de cobranza</p>
          <h2 className="font-semibold">WhatsApp personalizado y llamadas</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Simula mensajes por adeudo. Si no se marca como visto en 3 dias, el sistema recomienda llamada telefonica.
          </p>
        </div>
        <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
          {pendingCalls.length} por llamar
        </span>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((debt) => {
          const outreach = outreachFor(debt);
          const phone = cleanPhone(debt.phone);
          const canCall = Boolean(outreach.sentAt && !outreach.seenAt && !outreach.calledAt && daysSinceSent(outreach, today) >= 3);
          return (
            <article key={debt.charge.id} className="grid gap-4 px-4 py-4 xl:grid-cols-[1.1fr_1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{debt.debtorName}</h3>
                  <span className={`rounded-md px-2 py-1 text-xs font-medium ${outreachClass(outreach, today)}`}>
                    {outreachLabel(outreach, today)}
                  </span>
                  {canCall && <span className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white">Llamar hoy</span>}
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  Contacto: {debt.contactName} - {debt.phone || "Sin telefono"} - {debt.siteName}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Saldo ${money(debt.balance)} por {debt.concept}. {debt.reason}.
                </p>
                <div className="mt-3 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
                  {whatsappMessage(debt)}
                </div>
              </div>
              <div className="grid content-start gap-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-zinc-50 px-3 py-2">
                    <p className="text-xs uppercase text-zinc-500">Enviado</p>
                    <p className="font-medium">{outreach.sentAt || "No"}</p>
                  </div>
                  <div className="rounded-md bg-zinc-50 px-3 py-2">
                    <p className="text-xs uppercase text-zinc-500">Visto</p>
                    <p className="font-medium">{outreach.seenAt || "No"}</p>
                  </div>
                </div>
                <div className="rounded-md bg-zinc-50 px-3 py-2">
                  <p className="text-xs uppercase text-zinc-500">Regla</p>
                  <p className="font-medium">
                    {outreach.sentAt && !outreach.seenAt
                      ? `${daysSinceSent(outreach, today)} dias sin visto`
                      : "Esperando primer contacto"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 xl:w-44 xl:flex-col">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                  disabled={!phone}
                  onClick={() => updateOutreach(debt, { sentAt: formatDate(today), seenAt: null, calledAt: null })}
                  type="button"
                  title={phone ? `Simular envio a ${phone}` : "Sin telefono"}
                >
                  <MessageCircle size={16} />
                  WhatsApp
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
                  disabled={!outreach.sentAt}
                  onClick={() => updateOutreach(debt, { seenAt: formatDate(today) })}
                  type="button"
                >
                  <Eye size={16} />
                  Visto
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  disabled={!canCall || !phone}
                  onClick={() => updateOutreach(debt, { calledAt: formatDate(today) })}
                  type="button"
                  title={canCall ? `Simular llamada a ${phone}` : "Disponible despues de 3 dias sin visto"}
                >
                  <Phone size={16} />
                  Llamar
                </button>
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay adeudos para contactar.</p>}
      </div>
    </section>
  );
}
