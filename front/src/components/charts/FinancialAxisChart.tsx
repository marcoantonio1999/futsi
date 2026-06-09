import { FinancialComboChart } from "./FinancialComboChart";
import type { FinancialRow } from "./chartTypes";

export function FinancialAxisChart({ rows }: { rows: FinancialRow[] }) {
  return <FinancialComboChart title="Ingresos vs egresos vs utilidad" rows={rows} compact />;
}
