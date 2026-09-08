import { Pencil, Trash2 } from "lucide-react";
import { statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { Student } from "../../types";
import { InfoChip, StatusPill } from "./shared";

import { StudentAvatar } from "./studentPhoto";

export function StudentCard({ student, token, onEdit, onDelete }: { student: Student; token: string; onEdit: (student: Student) => void; onDelete: (student: Student) => void }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <StudentAvatar student={student} token={token} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{student.full_name}</p>
              <StatusPill label={statusLabels[student.status]} tone={student.status === "active" ? "ok" : student.status === "paused" || student.status === "injured" ? "warn" : "neutral"} />
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
        <div className="flex shrink-0 items-center gap-2 self-start">
          <button type="button" className="student-button secondary" onClick={() => onEdit(student)} aria-label={`Editar a ${student.full_name}`}><Pencil size={14} /> Editar</button>
          <button type="button" className="student-delete-icon" onClick={() => onDelete(student)} title="Eliminar alumno" aria-label={`Eliminar a ${student.full_name}`}><Trash2 size={16} /></button>
        </div>
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
