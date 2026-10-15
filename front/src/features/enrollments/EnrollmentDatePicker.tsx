import { useId, useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { DayPicker, type DateRange } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import { CalendarDays, Check, X } from 'lucide-react';
import { calendarDateValue, displayCalendarDate, parseCalendarDate } from './enrollmentDates';
import 'react-day-picker/style.css';
import './enrollmentDatePicker.css';

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

type DateProps = { label: string; name: string; value: string; onChange: (value: string) => void; min?: string; max?: string; birthday?: boolean; required?: boolean; disabled?: boolean };
export function EnrollmentDatePicker({ label, name, value, onChange, min, max, birthday = false, required = false, disabled = false }: DateProps) {
  const [open, setOpen] = useState(false), id = useId();
  const selected = parseCalendarDate(value), now = new Date();
  const earliest = parseCalendarDate(min) || new Date(birthday ? now.getFullYear() - 110 : now.getFullYear() - 20, 0, 1);
  const latest = parseCalendarDate(max) || new Date(now.getFullYear() + 30, 11, 31);
  return <div className="enrollment-date-field"><label id={id}>{label}</label>
    <input type="hidden" name={name} value={value} disabled={disabled} />
    <Popover.Root open={open} onOpenChange={setOpen} modal="trap-focus">
      <Popover.Trigger type="button" className="enrollment-date-trigger" aria-labelledby={id} aria-required={required} disabled={disabled}>
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

export function EnrollmentDateRangePicker({ label, from, to, min, onChange }: { label: string; from: string; to: string; min?: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<DateRange | undefined>(), id = useId();
  const earliest = parseCalendarDate(min), now = new Date();
  const summary = from && to ? `${displayCalendarDate(from)} – ${displayCalendarDate(to)}` : 'Selecciona inicio y fin';
  return <div className="enrollment-date-field"><label id={id}>{label}</label>
    <input type="hidden" name="starts_on" value={from} /><input type="hidden" name="ends_on" value={to} />
    <Popover.Root open={open} modal="trap-focus" onOpenChange={next => { if (next) setDraft(from && to ? { from: parseCalendarDate(from), to: parseCalendarDate(to) } : undefined); setOpen(next); }}>
      <Popover.Trigger type="button" className="enrollment-date-trigger" aria-labelledby={id} aria-required="true"><CalendarDays size={18} aria-hidden="true" /><span>{summary}</span></Popover.Trigger>
      <CalendarPopover title={label}><DayPicker mode="range" locale={es} weekStartsOn={1} captionLayout="dropdown" navLayout="around" showOutsideDays
        autoFocus selected={draft} onSelect={setDraft} defaultMonth={parseCalendarDate(from) || now} startMonth={earliest || new Date(now.getFullYear() - 20, 0, 1)} endMonth={new Date(now.getFullYear() + 30, 11, 31)}
        disabled={earliest ? { before: earliest } : undefined} excludeDisabled />
        <div className="enrollment-date-range-footer"><p aria-live="polite">{draft?.from ? `${displayCalendarDate(calendarDateValue(draft.from))} – ${draft.to ? displayCalendarDate(calendarDateValue(draft.to)) : 'elige el último día'}` : 'Elige el primer y el último día.'}</p><small>El último día también cuenta como sancionado.</small>
          <div className="enrollment-date-range-actions"><button type="button" className="enrollment-date-reset" onClick={() => setDraft(undefined)}>Reiniciar</button><button type="button" disabled={!draft?.from || !draft?.to} onClick={() => { if (draft?.from && draft.to) { onChange(calendarDateValue(draft.from), calendarDateValue(draft.to)); setOpen(false); } }}><Check size={18} aria-hidden="true" /> Aplicar periodo</button></div>
        </div>
      </CalendarPopover>
    </Popover.Root>
  </div>;
}
