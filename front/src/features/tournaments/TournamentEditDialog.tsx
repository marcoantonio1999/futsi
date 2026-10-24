import type {Site, Tournament} from '../../types';
import {TournamentDialog} from './TournamentDialog';
import {SelectInput, TextInput} from '../../components/views/shared';

export function TournamentEditDialog({tournament, sites, onSave, onClose}: {
  tournament: Tournament; sites: Pick<Site, 'id' | 'name'>[];
  onSave: (id: number, payload: unknown) => Promise<unknown>; onClose: () => void;
}) {
  return <TournamentDialog title="Editar torneo" description={tournament.name} submitLabel="Guardar cambios" onClose={onClose} onSubmit={async form => {
    await onSave(tournament.id, {
      name: String(form.get('name')).trim(), site: Number(form.get('site')),
      starts_on: form.get('starts_on') || null, expected_weeks: form.get('expected_weeks') ? Number(form.get('expected_weeks')) : null,
      football_format: form.get('football_format'), billing_type: form.get('billing_type'), is_active: form.get('is_active') === 'true',
    });
  }}>
    <div className="tournament-form-grid">
      <TextInput label="Nombre del torneo" name="name" required maxLength={140} defaultValue={tournament.name}/>
      <SelectInput label="Sede" name="site" required defaultValue={tournament.site}>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput>
      <TextInput label="Fecha de inicio" name="starts_on" type="date" defaultValue={tournament.starts_on || ''}/>
      <TextInput label="Duración prevista (semanas)" name="expected_weeks" type="number" min={1} max={32767} step={1} defaultValue={tournament.expected_weeks ?? ''}/>
      <SelectInput label="Modalidad" name="football_format" required defaultValue={tournament.football_format || ''}>
        <option value="" disabled>Selecciona modalidad</option><option value="fut6">Fut 6 · 12 jugadores por equipo</option><option value="fut7">Fut 7 · 14 jugadores por equipo</option><option value="fut8">Fut 8 · 16 jugadores por equipo</option>
      </SelectInput>
      <SelectInput label="Tipo de cobro" name="billing_type" required defaultValue={tournament.billing_type}><option value="weekly_match">Pago semanal</option><option value="full_tournament">Torneo completo</option></SelectInput>
      <SelectInput label="Estado del torneo" name="is_active" required defaultValue={String(tournament.is_active)}><option value="true">Activo</option><option value="false">Cerrado</option></SelectInput>
    </div>
    <p className="tournament-info">Se conservan equipos, inscripciones, firmas y pagos. La configuración de cobro no recalcula cargos existentes. Solo se permite cambiar de sede si el torneo aún no tiene equipos ni inscripciones.</p>
  </TournamentDialog>;
}
