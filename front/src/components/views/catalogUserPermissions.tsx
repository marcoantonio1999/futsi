import { useEffect, useState } from "react";
import { roleLabels } from "../../appState";
import type { TabKey, User } from "../../types";

export const sectionPermissionOptions: Array<{ key: TabKey; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "billing", label: "Cobranza" },
  { key: "debts", label: "Adeudos" },
  { key: "attendance", label: "Asistencia" },
  { key: "unknowns", label: "Desconocidos" },
  { key: "sports", label: "Deportivo" },
  { key: "tournaments", label: "Torneos" },
  { key: "expenses", label: "Gastos" },
  { key: "students", label: "Alumnos" },
  { key: "guardians", label: "Representantes" },
  { key: "uniforms", label: "Uniformes" },
  { key: "coaches", label: "Coaches" },
  { key: "referees", label: "Arbitros" },
  { key: "sales-estimate", label: "Estimacion ventas" },
  { key: "income-statement", label: "Estado resultados" },
  { key: "daily-operation", label: "Operacion diaria" },
  { key: "invoices", label: "Facturas" },
  { key: "historical", label: "Historico" },
  { key: "discrepancies", label: "Discrepancias" },
];

export function toggleSection(sections: string[], key: string) {
  return sections.includes(key) ? sections.filter((item) => item !== key) : [...sections, key];
}

export function UserPermissionRow({ user, onUpdate }: { user: User; onUpdate: (userId: number, payload: unknown) => void }) {
  const [sections, setSections] = useState<string[]>(user.section_permissions || []);

  useEffect(() => {
    setSections(user.section_permissions || []);
  }, [user.id, user.section_permissions]);

  return (
    <div className="px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">{user.username}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {roleLabels[user.role]}{user.primary_site_name ? ` - ${user.primary_site_name}` : ""}{user.role === "coach" && user.coach_group_name ? ` - ${user.coach_group_name}` : ""}
          </p>
        </div>
        <button
          className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
          onClick={() => onUpdate(user.id, { section_permissions: sections })}
          type="button"
        >
          Guardar permisos
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sectionPermissionOptions.map((option) => (
          <label key={option.key} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={sections.includes(option.key)}
              onChange={() => setSections(toggleSection(sections, option.key))}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
