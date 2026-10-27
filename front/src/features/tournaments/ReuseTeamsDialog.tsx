import { Button, Input, Label, NativeSelect } from '../../components/ui/enrollment-ui';
import { useEffect, useState } from 'react';
import type { Team, Tournament } from '../../types';
import { apiRequest } from '../../api';
import { TournamentDialog } from './TournamentDialog';
type Candidate = {id:number;name:string;tournament_id:number;tournament__name:string;tournament__site__name:string;is_active:boolean};
type Listing = {results:Candidate[];count:number;tournaments:{tournament_id:number;tournament__name:string;tournament__site__name:string}[]};
export function ReuseTeamsDialog({token,targets,sites,onClose,onAdded}: {token:string;targets:Tournament[];sites:{id:number;name:string}[];onClose:()=>void;onAdded:(teams:Team[],skipped:string[])=>void}) {
  const [target,setTarget]=useState(''), [source,setSource]=useState(''), [search,setSearch]=useState(''), [query,setQuery]=useState('');
  const [page,setPage]=useState(1), [selected,setSelected]=useState<number[]>([]);
  const [listing,setListing]=useState<Listing>({results:[],count:0,tournaments:[]});
  const [loading,setLoading]=useState(true), [error,setError]=useState('');
  useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(search.trim());setPage(1)},350);return()=>window.clearTimeout(timer)},[search]);
  useEffect(()=>{
    const controller=new AbortController(); const params=new URLSearchParams({page:String(page)});
    if(target)params.set('target_id',target);if(source)params.set('source_id',source);if(query)params.set('search',query);
    setLoading(true);setError('');
    apiRequest<Listing>('/player-enrollments/reuse-teams/?'+params,token,{signal:controller.signal})
      .then(body=>{if(!controller.signal.aborted)setListing(body)})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[token,target,source,query,page]);
  return <TournamentDialog title="Agregar equipos existentes" description="Crea los equipos en el nuevo torneo sin modificar el anterior." submitLabel={`Agregar ${selected.length} equipo(s)`} onClose={onClose} onSubmit={async()=>{
    if(!target||!selected.length)throw new Error('Selecciona el torneo de destino y al menos un equipo.');
    const result=await apiRequest<{created:Team[];skipped:string[]}>('/player-enrollments/reuse-teams/',token,{method:'POST',body:JSON.stringify({target_id:Number(target),team_ids:selected})});
    onAdded(result.created,result.skipped);
  }}>
    <Label>Torneo de destino<NativeSelect required value={target} onChange={event=>{setTarget(event.target.value);setSource('');setSelected([]);setPage(1)}}><option value="">Selecciona el nuevo torneo</option>{targets.filter(row=>row.is_active).map(row=><option key={row.id} value={row.id}>{row.name} · {sites.find(site=>site.id===row.site)?.name}</option>)}</NativeSelect></Label>
    <Label>Torneo de origen<NativeSelect value={source} onChange={event=>{setSource(event.target.value);setPage(1)}}><option value="">Todos los torneos anteriores</option>{listing.tournaments.filter(row=>String(row.tournament_id)!==target).map(row=><option key={row.tournament_id} value={row.tournament_id}>{row.tournament__name} · {row.tournament__site__name}</option>)}</NativeSelect></Label>
    <Label>Buscar equipo<Input value={search} maxLength={140} onChange={event=>setSearch(event.target.value)} /></Label>
    <p className="tournament-info">Se copian el nombre y los datos del delegado. No se copian jugadores, inscripciones, firmas, pagos ni partidos. Los equipos repetidos en el destino se omiten.</p>
    {error&&<p role="alert" className="tournament-feedback error">{error}</p>}
    {loading?<p role="status">Cargando equipos…</p>:<div className="reuse-team-list">{listing.results.map(row=><Label key={row.id} className="reuse-team-option"><Input type="checkbox" disabled={!target} checked={selected.includes(row.id)} onChange={()=>setSelected(previous=>previous.includes(row.id)?previous.filter(id=>id!==row.id):[...previous,row.id])}/><span><strong>{row.name}</strong><small>{row.tournament__name} · {row.tournament__site__name}{!row.is_active?' · Inactivo':''}</small></span></Label>)}{!listing.results.length&&<p>No hay equipos con estos filtros.</p>}</div>}
    <p role="status">{selected.length} equipo(s) seleccionado(s)</p><div className="reuse-team-pagination"><Button type="button" disabled={page===1||loading} onClick={()=>setPage(value=>value-1)}>Anterior</Button><span>Página {page}</span><Button type="button" disabled={page*50>=listing.count||loading} onClick={()=>setPage(value=>value+1)}>Siguiente</Button></div>
  </TournamentDialog>;
}
