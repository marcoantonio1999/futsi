import { useEffect, useId, useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { DayPicker, type DateRange } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import { CalendarDays, Check, X } from 'lucide-react';
import { calendarDateValue, displayCalendarDate, parseCalendarDate } from './enrollmentDates';
import 'react-day-picker/style.css';
import './enrollmentDatePicker.css';

const nativeDateQuery = '(max-width: 767px), (pointer: coarse)';
function useNativeDatePicker() {
  const [native, setNative] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(nativeDateQuery).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(nativeDateQuery), update = () => setNative(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return native;
}

// shadcn/ui Base Date Picker composition (Popover + React DayPicker), with scoped
// BPower styles so the legacy enrollment form's input/button rules cannot leak in.
function CalendarPopover({ title, children }: { title: string; children: ReactNode }) {
  return <Popover.Portal><Popover.Positioner className="enrollment-date-positioner" sideOffset={6} align="start" collisionPadding={4}>
    <Popover.Popup className="enrollment-date-popup">
      <header className="enrollment-date-heading"><Popover.Title>{title}</Popover.Title><Popover.Close className="enrollment-date-close" aria-label="Cerrar calendario"><X size={18} /></Popover.Close></header>
      {children}
    </Popover.Popup>
  </Popover.Positioner></Popover.Portal>;
}

type DateProps = { label: string; name: string; value: string; onChange: (value: string) => void; min?: string; max?: string; birthday?: boolean; required?: boolean; disabled?: boolean; invalid?: boolean; describedBy?: string };
export function EnrollmentDatePicker({ label, name, value, onChange, min, max, birthday = false, required = false, disabled = false, invalid = false, describedBy }: DateProps) {
  const [open, setOpen] = useState(false), id = useId();
  const native = useNativeDatePicker();
  useEffect(() => { if (native) setOpen(false); }, [native]);
  const selected = parseCalendarDate(value), now = new Date();
  const earliest = parseCalendarDate(min) || new Date(birthday ? now.getFullYear() - 110 : now.getFullYear() - 20, 0, 1);
  const latest = parseCalendarDate(max) || new Date(now.getFullYear() + 30, 11, 31);
  if (native) return <div className="enrollment-date-field enrollment-native-date"><label htmlFor={id}>{label}</label>
    <input id={id} type="date" name={name} value={value} required={required} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} autoComplete={birthday ? 'bday' : undefined}
      min={calendarDateValue(earliest)} max={calendarDateValue(latest)} onChange={event => onChange(event.target.value)} />
  </div>;
  return <div className="enrollment-date-field"><label id={id}>{label}</label>
    <input type="hidden" name={name} value={value} disabled={disabled} />
    <Popover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
      <Popover.Trigger type="button" className="enrollment-date-trigger" aria-labelledby={id} aria-required={required} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled}>
        <CalendarDays size={18} aria-hidden="true" /><span>{displayCalendarDate(value) || (birthday ? 'Selecciona tu fecha de nacimiento' : 'Selecciona una fecha')}</span>
      </Popover.Trigger>
      <CalendarPopover title={label}><DayPicker mode="single" locale={es} weekStartsOn={1} captionLayout="dropdown" navLayout="around" showOutsideDays
        autoFocus selected={selected} defaultMonth={selected || (birthday ? new Date(now.getFullYear() - 18, 0, 1) : now)} startMonth={earliest} endMonth={latest}
        disabled={[{ before: earliest }, { after: latest }]} onSelect={date => { if (date) { onChange(calendarDateValue(date)); setOpen(false); } }}
        footer={birthday ? 'Elige el mes, el año y después el día.' : undefined} />
      </CalendarPopover>
    </Popover.Root>
  </div>;
}

export function EnrollmentDateRangePicker({ label, from, to, min, onChange, required = true, fromName = 'starts_on', toName = 'ends_on', hint = 'El último día también cuenta como sancionado.' }: { label: string; from: string; to: string; min?: string; onChange: (from: string, to: string) => void; required?: boolean; fromName?: string; toName?: string; hint?: string }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<DateRange | undefined>(), id = useId();
  const native = useNativeDatePicker();
  useEffect(() => { if (native) setOpen(false); }, [native]);
  const earliest = parseCalendarDate(min), now = new Date();
  if (native) return <fieldset className="enrollment-date-field enrollment-native-range"><legend>{label}</legend>
    <div className="enrollment-native-range-inputs"><div className="enrollment-native-date"><label htmlFor={id + '-from'}>Desde</label>
      <input id={id + '-from'} name={fromName} type="date" required={required} value={from} min={min}
        onChange={event => { const next = event.target.value; onChange(next, to && next && to < next ? '' : to); }} /></div>
      <div className="enrollment-native-date"><label htmlFor={id + '-to'}>Hasta (último día)</label>
        <input id={id + '-to'} name={toName} type="date" required={required} value={to} min={from && (!min || from > min) ? from : min} onChange={event => onChange(from, event.target.value)} /></div>
    </div><small>{hint}</small>
    {!required && (from || to) && <button type="button" onClick={() => onChange('', '')}>Limpiar filtro</button>}
  </fieldset>;
  const summary = from && to ? `${displayCalendarDate(from)} – ${displayCalendarDate(to)}` : 'Selecciona inicio y fin';
  return <div className="enrollment-date-field"><label id={id}>{label}</label>
    <input type="hidden" name={fromName} value={from} /><input type="hidden" name={toName} value={to} />
    <Popover.Root open={open} modal="trap-focus" onOpenChange={next => { if (next) setDraft(from && to ? { from: parseCalendarDate(from), to: parseCalendarDate(to) } : undefined); setOpen(next); }}>
      <Popover.Trigger type="button" className="enrollment-date-trigger" aria-labelledby={id} aria-required={required}><CalendarDays size={18} aria-hidden="true" /><span>{summary}</span></Popover.Trigger>
      <CalendarPopover title={label}><DayPicker mode="range" locale={es} weekStartsOn={1} captionLayout="dropdown" navLayout="around" showOutsideDays
        autoFocus selected={draft} onSelect={setDraft} defaultMonth={parseCalendarDate(from) || now} startMonth={earliest || new Date(now.getFullYear() - 20, 0, 1)} endMonth={new Date(now.getFullYear() + 30, 11, 31)}
        disabled={earliest ? { before: earliest } : undefined} excludeDisabled />
        <div className="enrollment-date-range-footer"><p aria-live="polite">{draft?.from ? `${displayCalendarDate(calendarDateValue(draft.from))} – ${draft.to ? displayCalendarDate(calendarDateValue(draft.to)) : 'elige el último día'}` : 'Elige el primer y el último día.'}</p><small>{hint}</small>
          <div className="enrollment-date-range-actions"><button type="button" className="enrollment-date-reset" onClick={() => setDraft(undefined)}>Reiniciar</button><button type="button" disabled={!draft?.from || !draft?.to} onClick={() => { if (draft?.from && draft.to) { onChange(calendarDateValue(draft.from), calendarDateValue(draft.to)); setOpen(false); } }}><Check size={18} aria-hidden="true" /> Aplicar periodo</button></div>
          {!required && <button type="button" className="enrollment-date-reset" style={{marginTop:8}} onClick={() => { onChange('', ''); setOpen(false); }}>Limpiar filtro</button>}
        </div>
      </CalendarPopover>
    </Popover.Root>
  </div>;
}
