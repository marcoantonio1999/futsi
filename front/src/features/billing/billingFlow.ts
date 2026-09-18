import type { Charge, Discount, Payment } from "../../types";

export function amountInCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function paymentValidation(charge: Charge, amount: string) {
  if (!["pending", "partial"].includes(charge.status)) return "Este cargo ya no está pendiente de pago.";
  const cents = amountInCents(amount);
  const balance = amountInCents(charge.balance);
  if (cents === null || cents <= 0) return "Escribe un monto mayor a cero, con hasta dos decimales.";
  if (balance === null || cents > balance) return "El pago no puede superar el saldo pendiente.";
  return "";
}

export type BillingMutation = (payload: unknown) => Promise<unknown>;

export type DirectCollectionAttempt = { charge?: Charge; discount?: Discount; payment?: Payment };
function confirmedRecord(value: unknown): asserts value is { id: number } {
  if (!value || typeof value !== "object" || !("id" in value) || !Number.isInteger(value.id)) throw new Error("El servidor no confirmó el registro. Revisa los movimientos antes de repetirlo.");
}

// Each completed step is retained: retrying a rejected payment never recreates its charge/discount.
export async function collectDirect(attempt: DirectCollectionAttempt, input: {
  charge: unknown; discountCents: number; reason: string; totalCents: number; method: string;
}, callbacks: { charge: BillingMutation; discount?: BillingMutation; payment: BillingMutation; onCharge: (charge: Charge) => void }) {
  if (!attempt.charge) {
    const result = await callbacks.charge(input.charge);
    confirmedRecord(result);
    if (!("balance" in result)) throw new Error("No se confirmó el saldo del cargo.");
    attempt.charge = result as Charge;
    callbacks.onCharge(attempt.charge);
  }
  if (input.discountCents > 0 && !attempt.discount) {
    if (!callbacks.discount) throw new Error("No tienes disponible la aplicación de descuentos.");
    const result = await callbacks.discount({ charge: attempt.charge.id, amount: (input.discountCents / 100).toFixed(2), reason: input.reason });
    confirmedRecord(result);
    if (!("status" in result)) throw new Error("No se confirmó el estado del descuento.");
    attempt.discount = result as Discount;
  }
  if (attempt.discount && attempt.discount.status !== "approved") return "approval" as const;
  if (input.totalCents > 0 && !attempt.payment) {
    const result = await callbacks.payment({ charge: attempt.charge.id, amount: (input.totalCents / 100).toFixed(2), method: input.method, channel: input.method === "card" ? "card_terminal" : "cash_confirmation" });
    confirmedRecord(result);
    if (!("status" in result)) throw new Error("No se confirmó el estado del pago.");
    attempt.payment = result as Payment;
  }
  return "complete" as const;
}
