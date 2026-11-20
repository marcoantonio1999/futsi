import { Button } from "../../components/ui/enrollment-ui";

export function RolePageButtons({ page, count, onChange, label }: {
  page: number; count: number; label: string; onChange: (page: number) => void;
}) {
  if (count < 2) return null;
  return <div className="game-role-pagination" role="group" aria-label={label}>
    <Button type="button" aria-label={`${label}: anterior`} disabled={!page} onClick={() => onChange(page - 1)}>‹</Button>
    <span aria-live="polite">{page + 1}/{count}</span>
    <Button type="button" aria-label={`${label}: siguiente`} disabled={page + 1 === count} onClick={() => onChange(page + 1)}>›</Button>
  </div>;
}
