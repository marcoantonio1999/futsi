import { money } from "../../utils/format";
import type { AppData } from "../../types";
import { TableHeader } from "./shared";

export function CoachHoursPanel({ data }: { data: AppData }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Horas recientes" count={data.coachWorkLogs.length} />
      <div className="divide-y divide-zinc-100">
        {data.coachWorkLogs.map((log) => (
          <div key={log.id} className="px-4 py-3 text-sm">
            <p className="font-medium">{log.work_date} - {log.activity}</p>
            <p className="mt-1 text-zinc-500">{Number(log.hours).toFixed(1)} h - ${money(log.total_amount)}</p>
            {log.notes && <p className="mt-1 text-zinc-500">{log.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
