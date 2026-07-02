import { money } from "../../utils/format";
import type { Student } from "../../types";
import { TableHeader } from "../../components/views/shared";

export function CoachAlertsPanel({ medicalAlerts, debtAlerts }: { medicalAlerts: Student[]; debtAlerts: Student[] }) {
  const visibleAlerts = [...medicalAlerts, ...debtAlerts.filter((student) => !medicalAlerts.some((medical) => medical.id === student.id))];
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Alertas del coach" count={medicalAlerts.length + debtAlerts.length} />
      <div className="divide-y divide-zinc-100">
        {visibleAlerts.map((student) => (
          <div key={student.id} className="px-4 py-3">
            <p className="font-medium">{student.full_name}</p>
            {student.medical_notes && <p className="mt-1 text-sm text-red-700">{student.medical_notes}</p>}
            {student.open_charge_count > 0 && <p className="mt-1 text-sm text-amber-700">Pago pendiente: ${money(student.balance_due)}</p>}
          </div>
        ))}
        {medicalAlerts.length + debtAlerts.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin alertas para este grupo.</p>}
      </div>
    </div>
  );
}
