export type FileContact = {
  phone: string;
  name: string;
  campaign_status: string;
  mutual_interaction: string;
  pending_response: string;
  academy_relationship: string;
  league_relevance: string;
  age_bucket: string;
  started_by: string;
  period: string;
  year: string;
  month: string;
  team_responded: string;
};

export type FileProfile = 'academy' | 'league' | 'generic';
export type FileFacets = Record<string, string[]>;
export type FileFilters = {
  campaign_status: string;
  mutual_interaction: string;
  pending_response: string;
  relationship: string;
  age_bucket: string;
  started_by: string;
  year: string;
  month: string;
  team_responded: string;
};

export const initialFileFilters: FileFilters = {
  campaign_status: '',
  mutual_interaction: '',
  pending_response: '',
  relationship: '',
  age_bucket: '',
  started_by: '',
  year: '',
  month: '',
  team_responded: '',
};

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const isFileContactSendable = (contact: FileContact) => {
  const status = fold(contact.campaign_status || '');
  return !status.includes('no contactar') && !status.includes('no enviar');
};

export function academyRelationshipGroup(value: string) {
  const normalized = fold(value);
  if (!normalized || normalized.includes('sin relacion') || normalized.includes('no aplica') || normalized.includes('no relacionado')) return 'Sin relación / no aplica';
  if (normalized.includes('mixto') || normalized.includes('baja parcial') || (normalized.includes('alumn') && normalized.includes('sin continuidad'))) return 'Mixto';
  if (normalized.includes('prospecto') || normalized.includes('lista de espera') || normalized.includes('inscripcion no confirmada') || normalized.includes('prueba solicitada') || normalized.includes('visitante')) return 'Prospecto / lista de espera';
  if (normalized.includes('baja') || normalized.includes('exalumn') || normalized.includes('inactivo')) return 'Baja / exalumno';
  if (normalized.includes('alumn') || normalized.includes('familia')) return 'Alumno / familia';
  return 'Otro';
}

export function filterFileContacts(contacts: FileContact[], filters: FileFilters, profile: FileProfile) {
  return contacts.filter(contact => {
    if (!isFileContactSendable(contact)) return false;
    if (filters.campaign_status && contact.campaign_status !== filters.campaign_status) return false;
    if (filters.mutual_interaction && contact.mutual_interaction !== filters.mutual_interaction) return false;
    if (filters.pending_response && contact.pending_response !== filters.pending_response) return false;
    const relationship = profile === 'league' ? contact.league_relevance : academyRelationshipGroup(contact.academy_relationship);
    if (filters.relationship && relationship !== filters.relationship) return false;
    if (filters.age_bucket && contact.age_bucket !== filters.age_bucket) return false;
    if (filters.started_by && contact.started_by !== filters.started_by) return false;
    if (filters.year && contact.year !== filters.year) return false;
    if (filters.month && contact.month !== filters.month) return false;
    if (filters.team_responded && contact.team_responded !== filters.team_responded) return false;
    return true;
  });
}

const academyGroups = ['Alumno / familia', 'Prospecto / lista de espera', 'Baja / exalumno', 'Mixto', 'Sin relación / no aplica', 'Otro'];
const monthNames: Record<string, string> = { '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril', '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto', '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre' };

export function FileContactFilters({ contacts, facets, profile, filters, disabled, onChange, onApply }: {
  contacts: FileContact[];
  facets: FileFacets;
  profile: FileProfile;
  filters: FileFilters;
  disabled: boolean;
  onChange: (filters: FileFilters) => void;
  onApply: (contacts: FileContact[]) => void;
}) {
  const filtered = filterFileContacts(contacts, filters, profile);
  const excluded = contacts.filter(contact => !isFileContactSendable(contact)).length;
  const relationshipOptions = profile === 'league'
    ? facets.league_relevance || []
    : academyGroups.filter(group => contacts.some(contact => academyRelationshipGroup(contact.academy_relationship) === group));
  const campaignOptions = (facets.campaign_status || []).filter(status => {
    const normalized = fold(status);
    return !normalized.includes('no contactar') && !normalized.includes('no enviar');
  });
  const update = (key: keyof FileFilters, value: string) => onChange({ ...filters, [key]: value });
  const select = (key: keyof FileFilters, label: string, options: string[], optionLabel?: (value: string) => string) => (
    <label>{label}<select value={filters[key]} disabled={disabled} onChange={event => update(key, event.target.value)}>
      <option value="">Todos</option>{options.map(value => <option key={value} value={value}>{optionLabel ? optionLabel(value) : value}</option>)}
    </select></label>
  );

  return <section className="bulk-file-filters" aria-label="Filtros de contactos del archivo">
    <div><h4>Filtra los contactos de este archivo</h4><p>Estos datos se leen directamente del Excel o CSV; los números no necesitan existir en Supabase.</p></div>
    <div className="bulk-filter-grid">
      {select('campaign_status', 'Envío', campaignOptions)}
      {select('mutual_interaction', 'Interacción de ambos lados', facets.mutual_interaction || [])}
      {select('pending_response', 'Pendiente de respuesta', facets.pending_response || [])}
      {select('relationship', profile === 'league' ? 'Relevancia para liga' : 'Relación con academia', relationshipOptions)}
      {select('age_bucket', 'Antigüedad', facets.age_bucket || [])}
      {select('started_by', 'Inició la conversación', facets.started_by || [])}
      {select('year', 'Año de última interacción', facets.year || [])}
      {select('month', 'Mes de última interacción', facets.month || [], value => monthNames[value] || value)}
      {select('team_responded', 'Nuestro equipo respondió', facets.team_responded || [])}
    </div>
    <div className="bulk-filter-result" aria-live="polite">
      <div><strong>{filtered.length} de {contacts.length} contactos cumplen los filtros</strong>{excluded > 0 && <span>{excluded} marcados como “No contactar” o “No enviar” se excluyen siempre.</span>}</div>
      <div className="bulk-actions"><button disabled={disabled || !Object.values(filters).some(Boolean)} onClick={() => onChange(initialFileFilters)}>Limpiar filtros</button><button className="primary" disabled={disabled || !filtered.length || filtered.length > 1000} onClick={() => onApply(filtered)}>{filtered.length > 1000 ? 'Reduce el resultado a 1,000 o menos' : `Revisar ${filtered.length} destinatarios`}</button></div>
    </div>
  </section>;
}
