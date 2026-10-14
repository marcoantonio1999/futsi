/** Lives inside each paper sheet, not in the screen-only operator toolbar. */
export function PrintableDelegate({ name }: { name?: string }) {
  return <p className="match-paper-delegate">Delegado: <strong>{name || "Sin delegado asignado"}</strong></p>;
}
