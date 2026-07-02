type MetricProps = {
  label: string;
  value: string | number;
  helper?: string;
};

export function Metric({ label, value, helper }: MetricProps) {
  return (
    <div className="motion-card rounded-md border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {helper && <p className="mt-1 text-xs text-zinc-500">{helper}</p>}
    </div>
  );
}
