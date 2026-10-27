import { useState } from 'react';
import { downloadApiFile } from '../../api';
import {filterQuery, type ResultFilter} from './ExamResultFilters';

export function ExamExportButton({token,examId,filters,disabled,onError}:{token:string;examId?:number;filters?:ResultFilter;disabled:boolean;onError:(message:string)=>void}) {
  const [exporting,setExporting]=useState(false);
  async function download() {
    setExporting(true);onError('');
    try {
      await downloadApiFile(`/recruitment-exams/export/${examId?`?${filterQuery({exam:examId,...filters})}`:''}`,token,examId?`examen-${examId}.xlsx`:'todos-los-examenes.xlsx');
    } catch(error) {
      onError(error instanceof Error?error.message:'No se pudo exportar el Excel. Vuelve a pulsar para intentarlo.');
    } finally {setExporting(false);}
  }
  return <button type="button" className="exam-export-excel" disabled={disabled||exporting} onClick={()=>void download()} title={examId?'Resultados de este examen con los filtros aplicados, de todas las páginas':'Todas las entregas de todos los exámenes'}>
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" focusable="false"><rect x="11" y="3" width="19" height="26" rx="2" fill="#fff"/><path d="M15 9h11M15 14h11M15 19h11M15 24h11M20 6v20" stroke="#107c41" strokeWidth="1.4"/><rect x="1" y="8" width="18" height="19" rx="2" fill="#0b542c"/><path d="m6 13 7 10m0-10L6 23" stroke="#fff" strokeWidth="2.6"/></svg>
    {exporting?'Generando Excel…':'Exportar Excel'}
  </button>;
}
