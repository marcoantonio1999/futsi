import { useMemo, useState } from "react";
import { Metric } from "../cards/Metric";
import { ChartCardHeader } from "../charts/ChartHelp";
import { money } from "../../utils/format";
import type { AppData, Site } from "../../types";
import { SelectInput, TableHeader, TextInput } from "./shared";
import { ExpenseMixChart, SiteContributionChart, TrendChart, WaterfallChart } from "./incomeStatementCharts";
import {
  buildEntries,
  buildMonthlyTrend,
  buildSiteContribution,
  groupByCategory,
  groupLabels,
  matchesFilters,
  sum,
  units,
  type BusinessUnit,
} from "./incomeStatementModel";

export function IncomeStatementPanel({ data }: { data: AppData }) {
  const entries = useMemo(() => buildEntries(data), [data]);
  const latestDate = entries.map((entry) => entry.date).filter(Boolean).sort().at(-1) || new Date().toISOString();
  const [unit, setUnit] = useState<BusinessUnit>("consolidated");
  const [siteId, setSiteId] = useState("all");
  const [month, setMonth] = useState(latestDate.slice(0, 7));
  const filtered = entries.filter((entry) => matchesFilters(entry, unit, siteId, month));
  const income = sum(filtered, "income");
  const operating = sum(filtered, "operating");
  const fixed = sum(filtered, "fixed");
  const corporate = sum(filtered, "corporate");
  const nonRecurrent = sum(filtered, "non_recurrent");
  const operatingUtility = income - operating;
  const beforeCorporate = operatingUtility - fixed;
  const net = beforeCorporate - corporate - nonRecurrent;
  const margin = income ? (net / income) * 100 : 0;
  const categoryRows = groupByCategory(filtered);
  const otherExpense = categoryRows.filter((row) => row.label === "Otros").reduce((total, row) => total + row.amount, 0);
  const totalExpenses = operating + fixed + corporate + nonRecurrent;
  const trendRows = buildMonthlyTrend(entries, unit, siteId, month);
  const contributionRows = buildSiteContribution(entries, data.sites, unit, month);
  const visibleContributionRows = siteId === "all" ? contributionRows : contributionRows.filter((row) => String(row.siteId || "") === siteId);
  const bestSite = visibleContributionRows[0];
  const worstSite = visibleContributionRows.slice().sort((a, b) => a.net - b.net)[0];
  const fixedAndCorporate = fixed + corporate;
  const fixedAndCorporateRatio = income ? (fixedAndCorporate / income) * 100 : 0;
  const selectedSite = siteId === "all" ? "Todas las sedes" : data.sites.find((site: Site) => String(site.id) === siteId)?.name || "Sede";

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_210px_210px_210px]">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Estado de resultados</p>
            <h2 className="text-xl font-semibold">Rentabilidad por unidad de negocio</h2>
            <p className="mt-1 text-sm text-zinc-500">Reporte mensual calculado desde pagos confirmados y gastos aprobados, sin recapturar informacion.</p>
          </div>
          <SelectInput label="Unidad" value={unit} onChange={(event) => setUnit(event.target.value as BusinessUnit)}>
            {units.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </SelectInput>
          <SelectInput label="Sede" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="all">Todas las sedes</option>
            {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </SelectInput>
          <TextInput label="Mes" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Ingresos" value={`$${money(income)}`} helper={selectedSite} />
        <Metric label="Utilidad operativa" value={`$${money(operatingUtility)}`} helper="Antes de fijos y corporativo" />
        <Metric label="Utilidad neta" value={`$${money(net)}`} helper={`${margin.toFixed(1)}% de margen`} />
        <Metric label="Gastos totales" value={`$${money(totalExpenses)}`} />
        <Metric label="Otros / gastos" value={`${totalExpenses ? ((otherExpense / totalExpenses) * 100).toFixed(1) : "0.0"}%`} helper={`$${money(otherExpense)} sin clasificar`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Mejor contribucion" value={bestSite ? `$${money(bestSite.net)}` : "$0.00"} helper={bestSite?.label || "Sin datos"} />
        <Metric label="Mayor presion" value={worstSite ? `$${money(worstSite.net)}` : "$0.00"} helper={worstSite?.label || "Sin datos"} />
        <Metric label="Fijos + corporativo" value={`$${money(fixedAndCorporate)}`} helper={`${fixedAndCorporateRatio.toFixed(1)}% de ingresos`} />
        <Metric label="No recurrente" value={`$${money(nonRecurrent)}`} helper="Mejoras / inversiones separadas de operacion" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Puente de utilidad"
            count={6}
            help="Lee la grafica de izquierda a derecha: empieza con ingresos, resta gastos operativos, fijos, corporativos y no recurrentes. La ultima barra muestra la utilidad neta que queda despues de esas capas."
          />
          <WaterfallChart income={income} operating={operating} fixed={fixed} corporate={corporate} nonRecurrent={nonRecurrent} net={net} />
        </div>
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Mezcla de gastos"
            count={categoryRows.filter((row) => row.group !== "income").length}
            help="Muestra de que categorias se compone el gasto del mes filtrado. La dona enseÃ±a proporcion; la lista de la derecha muestra monto, porcentaje, grupo financiero y cantidad de registros."
          />
          <ExpenseMixChart rows={categoryRows} />
        </div>
      </section>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <ChartCardHeader
          title="Tendencia anual"
          count={12}
          help="Compara mes por mes ingresos contra gastos. Las barras muestran volumen mensual y la linea/area muestra utilidad. Sirve para detectar meses donde la operacion vende bien pero el gasto se come el margen."
        />
        <TrendChart rows={trendRows} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Contribucion por sede"
            count={visibleContributionRows.length}
            help="Ordena las sedes por impacto financiero. Ingresos indica venta, gastos indica presion de costos y utilidad neta indica lo que realmente aporta la sede despues de operacion, fijos, corporativo y no recurrentes."
          />
          <SiteContributionChart rows={visibleContributionRows} />
        </div>
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Lectura ejecutiva" count={4} />
          <div className="divide-y divide-zinc-100 text-sm">
            <ExecutiveNote title="El consolidado no repite cobranza" text="Agrupa pagos confirmados y gastos aprobados en capas financieras para explicar utilidad, no solo registrar movimientos." />
            <ExecutiveNote title="Fijos y corporativo se separan de operacion" text="Esto evita castigar visualmente la operacion diaria cuando el problema viene de renta, corporativo o inversiones puntuales." />
            <ExecutiveNote title="Otros debe bajar" text="Si â€œOtrosâ€ crece, faltan categorias o reglas de captura. Meta sugerida: mantenerlo por debajo de 5% de gastos." />
            <ExecutiveNote title="Utilidad neta compara sedes completas" text="El ranking muestra sedes que venden mucho pero dejan poco margen despues de fijos, corporativo y no recurrentes." />
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <SummaryTable
          income={income}
          operating={operating}
          operatingUtility={operatingUtility}
          fixed={fixed}
          beforeCorporate={beforeCorporate}
          corporate={corporate}
          nonRecurrent={nonRecurrent}
          net={net}
        />
        <CategoryAuditTable rows={categoryRows} />
      </section>

      <SiteRankingTable rows={visibleContributionRows} />
    </div>
  );
}

function ExecutiveNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-4 py-3">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-zinc-500">{text}</p>
    </div>
  );
}

type SummaryTableProps = {
  income: number;
  operating: number;
  operatingUtility: number;
  fixed: number;
  beforeCorporate: number;
  corporate: number;
  nonRecurrent: number;
  net: number;
};

function SummaryTable({ income, operating, operatingUtility, fixed, beforeCorporate, corporate, nonRecurrent, net }: SummaryTableProps) {
  const rows: Array<[string, number, string]> = [
    ["Ingresos totales", income, "text-emerald-700"],
    ["Gastos operativos", -operating, "text-red-700"],
    ["Utilidad operativa", operatingUtility, operatingUtility >= 0 ? "text-emerald-700" : "text-red-700"],
    ["Gastos fijos", -fixed, "text-red-700"],
    ["Utilidad antes de corporativo", beforeCorporate, beforeCorporate >= 0 ? "text-emerald-700" : "text-red-700"],
    ["Gastos corporativos", -corporate, "text-red-700"],
    ["Gastos no recurrentes", -nonRecurrent, "text-zinc-700"],
    ["Utilidad neta", net, net >= 0 ? "text-emerald-700" : "text-red-700"],
  ];

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Estado de resultados resumido" count={9} />
      <div className="divide-y divide-zinc-100 text-sm">
        {rows.map(([label, value, tone]) => (
          <div key={label} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">{label}</span>
            <span className={`font-semibold tabular-nums ${tone}`}>${money(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryAuditTable({ rows }: { rows: Array<{ label: string; group: keyof typeof groupLabels; amount: number; count: number }> }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Detalle auditable por categoria" count={rows.length} />
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Grupo</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3 text-right">Registros</th>
              <th className="px-4 py-3 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.group}-${row.label}`} className="border-b border-zinc-100">
                <td className="px-4 py-3 text-zinc-500">{groupLabels[row.group]}</td>
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3 text-right">{row.count}</td>
                <td className={`px-4 py-3 text-right font-semibold ${row.group === "income" ? "text-emerald-700" : "text-red-700"}`}>${money(row.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-zinc-500" colSpan={4}>Sin registros para este filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SiteRankingTable({ rows }: { rows: Array<{ siteId: number | null; label: string; income: number; operating: number; fixed: number; corporate: number; nonRecurrent: number; net: number; margin: number }> }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Ranking financiero por sede" count={rows.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Sede</th>
              <th className="px-4 py-3 text-right">Ingresos</th>
              <th className="px-4 py-3 text-right">Operativos</th>
              <th className="px-4 py-3 text-right">Fijos</th>
              <th className="px-4 py-3 text-right">Corporativo</th>
              <th className="px-4 py-3 text-right">No recurrente</th>
              <th className="px-4 py-3 text-right">Utilidad neta</th>
              <th className="px-4 py-3 text-right">Margen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.siteId}-${row.label}`} className="border-b border-zinc-100">
                <td className="px-4 py-3 font-medium">{row.label}</td>
                <td className="px-4 py-3 text-right text-emerald-700">${money(row.income)}</td>
                <td className="px-4 py-3 text-right text-red-700">${money(row.operating)}</td>
                <td className="px-4 py-3 text-right text-red-700">${money(row.fixed)}</td>
                <td className="px-4 py-3 text-right text-red-700">${money(row.corporate)}</td>
                <td className="px-4 py-3 text-right text-zinc-700">${money(row.nonRecurrent)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${row.net >= 0 ? "text-blue-700" : "text-red-700"}`}>${money(row.net)}</td>
                <td className={`px-4 py-3 text-right ${row.margin >= 0 ? "text-blue-700" : "text-red-700"}`}>{row.margin.toFixed(1)}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-zinc-500" colSpan={8}>Sin registros para este filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
