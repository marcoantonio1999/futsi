import { AlertTriangle, Check, ClipboardCheck, X } from "lucide-react";
import { statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { AttendanceRecord, Student } from "../../types";
import { AttendanceButton, Avatar, StatusPill } from "./shared";

export function CoachAttendanceRow({
  student,
  record,
  locked,
  saving,
  onMark,
}: {
  student: Student;
  record: AttendanceRecord | undefined;
  locked: boolean;
  saving: boolean;
  onMark: (student: Student, status: AttendanceRecord["status"]) => void;
}) {
  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex gap-3">
        <Avatar name={student.full_name} imageUrl={student.photo_url} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{student.full_name}</p>
            <StatusPill label={statusLabels[student.status]} />
            {student.open_charge_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                <AlertTriangle size={12} /> Debe ${money(student.balance_due)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-500">{student.category} - {student.guardian_name} - {student.guardian_phone}</p>
          {student.medical_notes && <p className="mt-1 text-xs text-red-700">Medico: {student.medical_notes}</p>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <AttendanceButton active={record?.status === "present"} disabled={locked || saving} label="Asiste" icon={<Check size={16} />} onClick={() => onMark(student, "present")} />
        <AttendanceButton active={record?.status === "absent"} disabled={locked || saving} label="Falta" icon={<X size={16} />} onClick={() => onMark(student, "absent")} />
        <AttendanceButton active={record?.status === "justified"} disabled={locked || saving} label="Justif." icon={<ClipboardCheck size={16} />} onClick={() => onMark(student, "justified")} />
      </div>
    </div>
  );
}
