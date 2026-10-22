import { useState, type FormEvent } from 'react';
import { ExamFiltersModal } from './ExamFiltersModal';

export type ResultFilter = { ordering: string; top: string; q: string; status: string; min_score: string; max_score: string };
export const emptyFilters: ResultFilter = { ordering: 'newest', top: '', q: '', status: '', min_score: '', max_score: '' };
export const filterQuery = (values: object) => new URLSearchParams(Object.entries(values).filter(([,v]) => v !== '').map(([k,v]) => [k,String(v)])).toString();

export function ExamResultFilters({ onApply, busy, error, initialFilters = emptyFilters }: { onApply: (f: ResultFilter) => Promise<boolean>; busy: boolean; error?: string; initialFilters?: ResultFilter }) {
  const [filters, setFilters] = useState(initialFilters);
  const [open, setOpen] = useState(false);
  const active = (Object.keys(emptyFilters) as (keyof ResultFilter)[]).some(key => initialFilters[key] !== emptyFilters[key]);
  const change = (key: keyof ResultFilter, value: string) => setFilters(f => ({ ...f,[key]:value }));
  async function submit(values: ResultFilter) { if (!busy && await onApply(values)) setOpen(false); }
  function apply(e: FormEvent) { e.preventDefault(); void submit(filters); }
  return <ExamFiltersModal title="Filtros de evaluaciones" open={open} onOpenChange={setOpen} busy={busy} active={active} error={error}>
    <form onSubmit={apply} className="exam-filter-panel" aria-label="Filtros de evaluaciones">
    <div className="exam-filter-grid">
      <label>Buscar participante<input value={filters.q} onChange={e => change('q', e.target.value)} placeholder="Nombre, correo o teléfono" /></label>
      <label>Ordenar por<select aria-label="Ordenar por" value={filters.ordering} onChange={e => change('ordering',e.target.value)}><option value="newest">Más recientes</option><option value="score_desc">Calificación más alta</option><option value="score_asc">Calificación más baja</option><option value="name">Nombre</option></select></label>
      <label>Selección<select aria-label="Selección" value={filters.top} onChange={e => change('top',e.target.value)}><option value="">Todos</option><option value="10">Mejor 10 % (incluye empates)</option></select></label>
      <label>Estado<select aria-label="Estado" value={filters.status} onChange={e => change('status',e.target.value)}><option value="">Todos</option><option value="graded">Calificados</option><option value="pending">Entregados por calificar</option><option value="unsubmitted">Sin entregar</option></select></label>
      <label>Calificación mínima<input type="number" min="0" max="10" step="0.01" value={filters.min_score} onChange={e => change('min_score',e.target.value)} /></label>
      <label>Calificación máxima<input type="number" min="0" max="10" step="0.01" value={filters.max_score} onChange={e => change('max_score',e.target.value)} /></label>
    </div><div className="exam-actions exam-filter-actions"><button className="exam-primary" disabled={busy}>Aplicar filtros</button><button type="button" disabled={busy} onClick={() => { setFilters(emptyFilters); void submit(emptyFilters); }}>Limpiar filtros</button></div>
    <p className="exam-muted">El mejor 10 % se calcula sobre todas las entregas calificadas de este examen, no solo esta página. Se redondea hacia arriba e incluye empates. Pendientes no cuentan como cero.</p>
  </form></ExamFiltersModal>;
}
