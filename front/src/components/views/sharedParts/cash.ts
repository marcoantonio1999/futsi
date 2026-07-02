import type { AppData } from "../../../types";

export function calculateCashBySite(data: AppData, siteFilter?: number[]) {
  const allowed = siteFilter ? new Set(siteFilter) : null;
  const siteRows = data.sites
    .filter((site) => !allowed || allowed.has(site.id))
    .map((site) => ({
      siteId: site.id,
      siteName: site.name,
      cashPayments: 0,
      cashIn: 0,
      cashOut: 0,
      vaultTransfer: 0,
      adjustment: 0,
      cashInBox: 0,
    }));
  const rowsBySite = new Map(siteRows.map((row) => [row.siteId, row]));
  const chargesById = new Map(data.charges.map((charge) => [charge.id, charge]));

  data.payments
    .filter((payment) => payment.method === "cash" && (payment.status === "registered" || payment.status === "reconciled"))
    .forEach((payment) => {
      if (payment.charge === null) return;
      const charge = chargesById.get(payment.charge);
      const siteId = charge?.site;
      const row = siteId !== undefined ? rowsBySite.get(siteId) : null;
      if (row) row.cashPayments += Number(payment.amount || 0);
    });

  data.cashMovements.forEach((movement) => {
    const row = rowsBySite.get(movement.site);
    if (!row) return;
    const amount = Number(movement.amount || 0);
    if (movement.movement_type === "cash_in") row.cashIn += amount;
    if (movement.movement_type === "cash_out") row.cashOut += amount;
    if (movement.movement_type === "vault_transfer") row.vaultTransfer += amount;
    if (movement.movement_type === "adjustment") row.adjustment += amount;
  });

  return siteRows.map((row) => ({
    ...row,
    cashInBox: row.cashPayments + row.cashIn + row.adjustment - row.cashOut - row.vaultTransfer,
  }));
}

