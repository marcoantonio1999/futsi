export function validateEnrollmentName(parts: string[]): string {
  const normalized = parts.map(part => part.trim().replace(/\s+/g, " "));
  if (normalized.length !== 3 || normalized.some(part => !part)) {
    return "Escribe tus nombre(s), apellido paterno y apellido materno.";
  }
  if (normalized.some(part => !/\p{L}/u.test(part) || !/^[\p{L}\p{M} '.’\-]+$/u.test(part))) {
    return "Escribe tus nombres y apellidos sin números ni símbolos.";
  }
  if (normalized.some(part => part.length > 80) || normalized.join(" ").length > 160) {
    return "El nombre completo puede tener hasta 160 caracteres.";
  }
  return "";
}
