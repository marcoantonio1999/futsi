import { useState, type FormEvent } from 'react';
import { ExamFiltersModal } from './ExamFiltersModal';

export const skillOptions = [{id:"mathematics",label:"Matemáticas y análisis numérico"},{id:"sales",label:"Ventas y marketing"},{id:"ai",label:"Uso de IA"},{id:"processes",label:"Procesos y automatización"},{id:"management",label:"Gestión y prioridades"},{id:"information",label:"Análisis de información"}];
type SkillRanges = Record<string, {min:string;max:string}>;
export type ResultFilter = { skill_ranges: string; skill: string; ordering: string; top: string; q: string; status: string; min_score: string; max_score: string };
export const emptyFilters: ResultFilter = { skill_ranges: '', skill: '', ordering: 'newest', top: '', q: '', status: '', min_score: '', max_score: '' };
export const filterQuery = (values: object) => new URLSearchParams(Object.entries(values).filter(([,v]) => v !== '').map(([k,v]) => [k,String(v)])).toString();

export function ExamResultFilters({ onApply, busy, error, initialFilters = emptyFilters }: { onApply: (f: ResultFilter) => Promise<boolean>; busy: boolean; error?: string; initialFilters?: ResultFilter }) {
  const [filters, setFilters] = useState(initialFilters);
  const [open, setOpen] = useState(false);
  const active = (Object.keys(emptyFilters) as (keyof ResultFilter)[]).some(key => initialFilters[key] !== emptyFilters[key]);
  const change = (key: keyof ResultFilter, value: string) => setFilters(f => ({ ...f,[key]:value }));
  const ranges: SkillRanges = filters.skill_ranges ? JSON.parse(filters.skill_ranges) : {};
  function changeRange(id: string, value: {min:string;max:string} | null) {
    const next = {...ranges};
    if (value) next[id] = value; else delete next[id];
    change('skill_ranges', Object.keys(next).length ? JSON.stringify(next) : '');
  }
  async function submit(values: ResultFilter) { if (!busy && await onApply(values)) setOpen(false); }
  function apply(e: FormEvent) { e.preventDefault(); void submit(filters); }
  return <ExamFiltersModal title="Filtros de evaluaciones" open={open} onOpenChange={value => { if (value) setFilters(initialFilters); setOpen(value); }} busy={busy} active={active} error={error}>
    <form onSubmit={apply} className="exam-filter-panel" aria-label="Filtros de evaluaciones">
    <div className="exam-filter-grid">
      <label>Buscar participante<input value={filters.q} onChange={e => change('q', e.target.value)} placeholder="Nombre, correo o teléfono" /></label>

      <label>Ordenar por<select aria-label="Ordenar por" value={filters.ordering} onChange={e => change('ordering',e.target.value)}><option value="newest">Más recientes</option><option value="score_desc">Calificación general más alta</option><option value="score_asc">Calificación general más baja</option><option value="name">Nombre</option></select></label>
      <label>Selección<select aria-label="Selección" value={filters.top} onChange={e => change('top',e.target.value)}><option value="">Todos</option><option value="10">Mejor 10 % (incluye empates)</option></select></label>
      <label>Estado<select aria-label="Estado" value={filters.status} onChange={e => change('status',e.target.value)}><option value="">Todos</option><option value="graded">Calificados</option><option value="pending">Entregados por calificar</option><option value="unsubmitted">Sin entregar</option></select></label>
      <label>Calificación general mínima<input type="number" min="0" max="10" step="0.01" value={filters.min_score} onChange={e => change('min_score',e.target.value)} /></label>
      <label>Calificación general máxima<input type="number" min="0" max="10" step="0.01" value={filters.max_score} onChange={e => change('max_score',e.target.value)} /></label>
    </div>
    <fieldset className="exam-skill-ranges"><legend>Habilidades y rangos de nota</legend>
      <p className="exam-muted">Selecciona una o varias habilidades. Cada participante debe cumplir todos los rangos marcados. Las notas son sobre 10; sin desglose de una habilidad seleccionada, no aparece en los resultados.</p>
      {skillOptions.map(({id,label}) => <div className="exam-skill-range" key={id}>
        <label className="exam-skill-toggle"><input type="checkbox" checked={!!ranges[id]} onChange={e => changeRange(id,e.target.checked ? {min:'',max:''} : null)} />{label}</label>
        {ranges[id] && <div className="exam-skill-bounds">
          <label>Mínimo<input aria-label={`${label}: mínimo`} type="number" min="0" max={ranges[id].max || '10'} step="0.01" placeholder="0" value={ranges[id].min} onChange={e => changeRange(id,{...ranges[id],min:e.target.value})}/></label>
          <label>Máximo<input aria-label={`${label}: máximo`} type="number" min={ranges[id].min || '0'} max="10" step="0.01" placeholder="10" value={ranges[id].max} onChange={e => changeRange(id,{...ranges[id],max:e.target.value})}/></label>
        </div>}
      </div>)}
    </fieldset>
    <div className="exam-actions exam-filter-actions"><button className="exam-primary" disabled={busy}>Aplicar filtros</button><button type="button" disabled={busy} onClick={() => { setFilters(emptyFilters); void submit(emptyFilters); }}>Limpiar filtros</button></div>
    <p className="exam-muted">El orden por nota y el mejor 10 % usan la calificación general. Con habilidades seleccionadas, el mejor 10 % se calcula entre quienes cumplen todos sus rangos, antes de los demás filtros, e incluye empates. El Excel respeta los filtros e incluye siempre las seis habilidades.</p>
  </form></ExamFiltersModal>;
}
