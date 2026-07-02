import { FormEvent, useMemo, useState } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import { Metric } from "../../components/cards/Metric";
import { money } from "../../utils/format";
import type { AppData, Site, Student, User } from "../../types";
import { FormationBoard } from "../../components/views/formationBoard";
import { UniformKitPreview } from "../../components/views/uniforms";
import { InvoiceRows, SelectInput, StaffPaymentInbox, TableHeader, TextInput } from "../../components/views/shared";

type CoachTeamOption = {
  key: string;
  label: string;
  helper: string;
  type: "academy_group" | "academy_tournament";
  site: Site | null;
  members: Array<Pick<Student, "id" | "full_name">>;
};

function uniqueByKey<T extends { key: string }>(items: T[]) {
  const map = new Map<string, T>();
  items.forEach((item) => {
    if (!map.has(item.key)) map.set(item.key, item);
  });
  return Array.from(map.values());
}

function buildCoachTeamOptions(data: AppData): CoachTeamOption[] {
  const groupOptions = data.students
    .filter((student) => student.group_name)
    .map((student) => {
      const site = data.sites.find((item) => item.id === student.site) ?? null;
      const members = data.students.filter((item) => item.site === student.site && item.group_name === student.group_name);
      return {
        key: `academy-group-${student.site}-${student.group_name}`,
        label: student.group_name || "Grupo academia",
        helper: `${site?.name || "Sede"} - entrenamiento academia`,
        type: "academy_group" as const,
        site,
        members,
      };
    });

  const tournamentOptions = data.studentTournamentRegistrations
    .filter((registration) => registration.team && registration.team_name)
    .map((registration) => {
      const site = data.sites.find((item) => item.id === registration.site) ?? null;
      const members = data.studentTournamentRegistrations
        .filter((item) => item.team === registration.team)
        .map((item) => data.students.find((student) => student.id === item.student))
        .filter(Boolean) as Student[];
      return {
        key: `academy-tournament-${registration.team}`,
        label: registration.team_name || "Equipo torneo",
        helper: `${registration.tournament_name || "Torneo academia"} - ${site?.name || "Sede"}`,
        type: "academy_tournament" as const,
        site,
        members,
      };
    });

  return uniqueByKey([...groupOptions, ...tournamentOptions]).filter((option) => option.members.length > 0);
}

export function CoachDashboardPanel({
  user,
  data,
  onCreateWorkLog,
  onAcceptStaffPayment,
  onRejectStaffPayment,
  onDownloadFile,
}: {
  user: User;
  data: AppData;
  onCreateWorkLog: (payload: unknown) => void;
  onAcceptStaffPayment: (requestId: number) => void;
  onRejectStaffPayment: (requestId: number) => void;
  onDownloadFile: (path: string, filename: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const options = useMemo(() => buildCoachTeamOptions(data), [data]);
  const [selectedKey, setSelectedKey] = useState(options[0]?.key || "");
  const [workForm, setWorkForm] = useState({ work_date: today, hours: "2", activity: "Entrenamiento", notes: "" });

  const selectedOption = options.find((option) => option.key === selectedKey) ?? options[0] ?? null;
  const selectedSite = selectedOption?.site ?? data.sites.find((site) => site.id === user.primary_site) ?? data.sites[0] ?? null;
  const siteIndex = selectedSite ? Math.max(0, data.sites.findIndex((site) => site.id === selectedSite.id)) : 0;
  const studentMembers = (selectedOption?.members as Student[] | undefined) ?? [];
  const medicalAlerts = studentMembers.filter((student) => "medical_notes" in student && student.medical_notes);
  const debtAlerts = studentMembers.filter((student) => "open_charge_count" in student && student.open_charge_count > 0);
  const totalHours = data.coachWorkLogs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const estimatedPay = data.coachWorkLogs.reduce((sum, log) => sum + Number(log.total_amount || 0), 0);

  function submitWorkLog(event: FormEvent) {
    event.preventDefault();
    onCreateWorkLog({
      work_date: workForm.work_date,
      hours: workForm.hours,
      activity: workForm.activity,
      notes: workForm.notes,
    });
    setWorkForm({ ...workForm, notes: "" });
  }

  return (
    <section className="grid gap-5" data-testid="coach-portal">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Equipos visibles" value={options.length} />
        <Metric label="Jugadores/alumnos" value={selectedOption?.members.length || 0} helper={selectedOption?.label || "Sin equipo"} />
        <Metric label="Alertas medicas" value={medicalAlerts.length} />
        <Metric label="Adeudos visibles" value={debtAlerts.length} />
        <Metric label="Horas registradas" value={totalHours.toFixed(1)} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-5">
          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Dashboard coach</p>
                <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{user.first_name || user.username}</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-300">Selecciona el grupo o equipo que vas a revisar.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_320px]">
              <SelectInput label="Equipo asignado" value={selectedOption?.key || ""} onChange={(event) => setSelectedKey(event.target.value)}>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} - {option.helper}
                  </option>
                ))}
              </SelectInput>
              {selectedSite && (
                <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                  <UniformKitPreview site={selectedSite} index={siteIndex} compact />
                </div>
              )}
            </div>
          </div>

          <FormationBoard students={selectedOption?.members || []} groupName={selectedOption?.label || "Equipo asignado"} />
        </div>

        <div className="grid gap-5">
          <form onSubmit={submitWorkLog} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="flex items-center gap-2 font-semibold text-zinc-950 dark:text-zinc-50">
              <ClipboardCheck size={16} /> Horas y nomina estimada
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-300">${money(user.coach_hourly_rate || 0)} por hora - estimado ${money(estimatedPay)}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TextInput label="Fecha" type="date" value={workForm.work_date} onChange={(event) => setWorkForm({ ...workForm, work_date: event.target.value })} />
              <TextInput label="Horas" type="number" min="0" step="0.25" value={workForm.hours} onChange={(event) => setWorkForm({ ...workForm, hours: event.target.value })} />
            </div>
            <TextInput className="mt-3" label="Actividad" value={workForm.activity} onChange={(event) => setWorkForm({ ...workForm, activity: event.target.value })} />
            <TextInput className="mt-3" label="Notas" value={workForm.notes} onChange={(event) => setWorkForm({ ...workForm, notes: event.target.value })} />
            <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" data-testid="coach-register-hours">
              <Plus size={16} /> Registrar horas
            </button>
          </form>

          <div className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <TableHeader title="Alertas del equipo" count={medicalAlerts.length + debtAlerts.length} />
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...medicalAlerts, ...debtAlerts.filter((student) => !medicalAlerts.some((medical) => medical.id === student.id))].slice(0, 8).map((student) => (
                <div key={student.id} className="px-4 py-3 text-sm">
                  <p className="font-medium text-zinc-950 dark:text-zinc-50">{student.full_name}</p>
                  {"medical_notes" in student && student.medical_notes && <p className="mt-1 text-red-700 dark:text-red-300">{student.medical_notes}</p>}
                  {"open_charge_count" in student && student.open_charge_count > 0 && <p className="mt-1 text-amber-700 dark:text-amber-300">Pago pendiente: ${money(student.balance_due)}</p>}
                </div>
              ))}
              {medicalAlerts.length + debtAlerts.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin alertas para este equipo.</p>}
            </div>
          </div>

          <StaffPaymentInbox requests={data.staffPaymentRequests} currentUser={user} onAccept={onAcceptStaffPayment} onReject={onRejectStaffPayment} />
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <TableHeader title="Facturas del coach" count={data.invoices.length} />
        <InvoiceRows invoices={data.invoices.slice(0, 5)} onDownloadFile={onDownloadFile} />
      </section>
    </section>
  );
}
