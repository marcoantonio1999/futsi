import { FormEvent } from "react";
import { Plus, Shield } from "lucide-react";
import type { AppData } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";

function today() {
  return new Date().toISOString().slice(0, 10);
}

type TournamentFormsProps = {
  isCoachView: boolean;
  data: AppData;
  onSubmitTournament: (event: FormEvent<HTMLFormElement>) => void;
};

export function TournamentForms({ isCoachView, data, onSubmitTournament }: TournamentFormsProps) {
  return (
    <div className="grid content-start gap-3">
      {!isCoachView && (
        <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Plus size={18} />
            <h3 className="font-semibold">Crear torneo o liguilla</h3>
          </div>
          <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={onSubmitTournament}>
            <SelectInput label="Sede" name="site" required>
              {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </SelectInput>
            <TextInput label="Nombre" name="name" placeholder="Liguilla Sub-12 Junio" required />
            <SelectInput label="Cobro" name="billing_type" defaultValue="weekly_match">
              <option value="weekly_match">Pago semanal</option>
              <option value="full_tournament">Torneo completo</option>
            </SelectInput>
            <TextInput label="Inicio" name="starts_on" type="date" defaultValue={today()} />
            <TextInput label="Semanas esperadas" name="expected_weeks" type="number" min="1" defaultValue={12} />
            <button className="self-end rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Crear torneo</button>
          </form>
        </div>
      )}

      {isCoachView && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex items-center gap-2 font-semibold">
            <Shield size={18} />
            Vista limitada para coach
          </div>
          <p className="mt-2">
            Los torneos, equipos, partidos y alumnos mostrados aqui se limitan al alcance de tus sesiones y alumnos asignados. La administracion de torneos queda reservada para admin/coordinacion.
          </p>
        </div>
      )}
    </div>
  );
}
