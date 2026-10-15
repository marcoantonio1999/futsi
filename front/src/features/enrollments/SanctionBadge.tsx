export type SanctionSummary = { id: number; starts_on: string; ends_on: string | null; status: "active" | "scheduled" | "awaiting_payment" };

export function SanctionBadge({ sanctions = [] }: { sanctions?: SanctionSummary[] }) {
  if (!sanctions.length) return null;
  const format = (date: string) => date.split("-").reverse().join("/");
  const active = sanctions.some(sanction => sanction.status !== "scheduled");
  const awaitingPayment = sanctions.some(sanction => sanction.status === "awaiting_payment");
  const start = sanctions.map(sanction => sanction.starts_on).sort()[0];
  const end = sanctions.some(sanction => !sanction.ends_on) ? null : sanctions.map(sanction => sanction.ends_on!).sort().at(-1);
  return <span className="player-sanction-badge"><span>{active ? "SANCIONADO" : `Sanción desde ${format(start)}`}</span>
    <span>{awaitingPayment ? "Pago pendiente" : end ? `Hasta ${format(end)}` : "Sin término"}{sanctions.length > 1 ? ` (${sanctions.length} sanciones)` : ""}</span>
  </span>;
}
