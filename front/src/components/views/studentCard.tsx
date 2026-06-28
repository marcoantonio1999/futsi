import { statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { Student } from "../../types";
import { Avatar, InfoChip, StatusPill } from "./shared";

export function StudentCard({ student, onEdit }: { student: Student; onEdit: (student: Student) => void }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <Avatar name={student.full_name} imageUrl={student.photo_url} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{student.full_name}</p>
              <StatusPill label={statusLabels[student.status]} />
              {student.open_charge_count > 0 && <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">Pago pendiente ${money(student.balance_due)}</span>}
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {student.site_name} - {student.group_name || student.category}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {student.guardian_name} - {student.guardian_phone || "Sin telefono"}
            </p>
          </div>
        </div>
        <button className="self-start rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium" onClick={() => onEdit(student)}>
          Editar control
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <InfoChip label="Uniforme" value={student.uniform_status === "delivered" ? "Entregado" : student.uniform_status === "paid" ? "Pagado" : "Pendiente"} tone={student.uniform_status === "delivered" ? "ok" : "warn"} />
        <InfoChip label="Responsiva" value={student.waiver_url ? "Registrada" : "Pendiente"} tone={student.waiver_url ? "ok" : "warn"} />
        <InfoChip label="Info medica" value={student.medical_notes ? "Con nota" : "Sin nota"} tone={student.medical_notes ? "danger" : "neutral"} />
        <InfoChip label="Descuentos" value={student.active_discounts.length ? `${student.active_discounts.length} activos` : "Sin descuentos"} tone={student.active_discounts.length ? "ok" : "neutral"} />
      </div>

      {(student.medical_notes || student.pause_start || student.pause_reason) && (
        <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          {student.medical_notes && <p className="text-red-700">Medico: {student.medical_notes}</p>}
          {student.pause_start && <p className="text-amber-700">Pausa: {student.pause_start} - {student.pause_end || "abierta"}</p>}
          {student.pause_reason && <p>Motivo: {student.pause_reason}</p>}
        </div>
      )}
    </div>
  );
}
