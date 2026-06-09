export function money(value: string | number) {
  return Number(value || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function compactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (absolute >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${money(value)}`;
}
