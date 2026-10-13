import { ArrowLeft, ArrowRight } from "lucide-react";
import { localDateKey, mondayKey, shiftDays } from "./communicationUtils";
import { inputClass, secondaryButtonClass } from "./model";

export function currentAuditStart(days: number) {
  return days === 7 ? mondayKey() : shiftDays(localDateKey(new Date()), 1 - days);
}
export function qualityWeekStart(value = new Date()) {
  return shiftDays(localDateKey(value), -value.getDay());
}
export function lastCompletedQualityWeek() {
  return shiftDays(qualityWeekStart(), -7);
}

export function AuditPeriodPicker({ days, start, onDaysChange, onStartChange, weeklyQuality = false }: {
  days: number; start: string; onDaysChange?: (days: number) => void; onStartChange: (start: string) => void; weeklyQuality?: boolean;
}) {
  const current = weeklyQuality ? qualityWeekStart() : currentAuditStart(days);
  return <div className="comm-toolbar comm-audit-period" aria-label={weeklyQuality ? "Semana de calidad de chats" : "Filtros del periodo"}>
    {!weeklyQuality && <label>Periodo <select className={inputClass} aria-label="Periodo de estadísticas" value={days} onChange={event => { const value = Number(event.target.value); onDaysChange?.(value); onStartChange(currentAuditStart(value)); }}>
      {[1, 2, 3, 4, 5, 6, 7, 30].map(value => <option key={value} value={value}>{value === 1 ? "1 día" : value === 7 ? "1 semana" : value === 30 ? "30 días" : `${value} días`}</option>)}
    </select></label>}
    <div className="comm-inline comm-week-picker">
      <button className={secondaryButtonClass} aria-label={weeklyQuality ? "Semana anterior" : "Periodo anterior"} onClick={() => onStartChange(shiftDays(start, -days))}><ArrowLeft size={16} /></button>
      <label>{weeklyQuality ? "Semana del" : "Desde"} <input className={inputClass} aria-label={weeklyQuality ? "Elegir semana de calidad" : "Inicio del periodo"} type="date" value={start} max={current} onChange={event => { if (event.target.value) onStartChange(weeklyQuality ? qualityWeekStart(new Date(event.target.value + "T12:00:00")) : days === 7 ? mondayKey(new Date(event.target.value + "T12:00:00")) : event.target.value); }} /></label>
      <span>al {shiftDays(start, days - 1)}</span>
      <button className={secondaryButtonClass} aria-label={weeklyQuality ? "Semana siguiente" : "Periodo siguiente"} disabled={start >= current} onClick={() => onStartChange(shiftDays(start, days) > current ? current : shiftDays(start, days))}><ArrowRight size={16} /></button>
      {start !== current && <button className="comm-link" onClick={() => onStartChange(current)}>{weeklyQuality ? "Semana en curso" : "Periodo actual"}</button>}
      {weeklyQuality && start !== lastCompletedQualityWeek() && <button className="comm-link" onClick={() => onStartChange(lastCompletedQualityWeek())}>Última semana completa</button>}
    </div>
  </div>;
}
