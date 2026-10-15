import { parseCalendarDate } from './enrollmentDates.ts';
import { validateEnrollmentName } from './enrollmentName.ts';

export type EnrollmentErrors = Record<string, string>;
export function birthDateError(value: string, max: string): string {
  if (!value) return 'Selecciona tu fecha de nacimiento.';
  if (!parseCalendarDate(value) || value > max || Number(value.slice(0, 4)) < Number(max.slice(0, 4)) - 110) return 'Selecciona una fecha de nacimiento válida, no posterior a hoy.';
  return '';
}
export function documentErrors(kinds: string[], files: Record<string, Blob | null>, labels: Record<string, string>): EnrollmentErrors {
  const errors: EnrollmentErrors = {};
  for (const kind of kinds) {
    if (!files[kind]) errors[kind] = `Falta adjuntar: ${labels[kind] || kind}.`;
    else if (files[kind]!.size > 20_000_000) errors[kind] = 'El archivo no debe superar 20 MB.';
  }
  return errors;
}
export function playerFieldErrors(values: Record<string, string>, minor: boolean): EnrollmentErrors {
  const errors: EnrollmentErrors = {};
  const names = ['given_names', 'paternal_surname', 'maternal_surname'];
  const titles = ['tus nombre(s)', 'tu apellido paterno', 'tu apellido materno'];
  names.forEach((key, index) => {
    const value = (values[key] || '').trim();
    if (!value) errors[key] = `Escribe ${titles[index]}.`;
    else {
      const parts = ['José', 'Pérez', 'López']; parts[index] = value;
      const error = validateEnrollmentName(parts);
      if (error) errors[key] = error;
    }
  });
  if (!names.some(key => errors[key]) && validateEnrollmentName(names.map(key => values[key] || ''))) {
    names.forEach(key => { errors[key] = 'El nombre completo no debe superar 160 caracteres.'; });
  }
  if (!(values.phone || '').trim()) errors.phone = 'Escribe tu teléfono de contacto.';
  if (minor && !(values.guardian_name || '').trim()) errors.guardian_name = 'Escribe el nombre del padre o tutor.';
  return errors;
}
