import { useEffect, useMemo, useState } from "react";
import { animate, motion } from "motion/react";

type MetricProps = {
  label: string;
  value: string | number;
  helper?: string;
};

type AnimatedMetricValue = {
  canAnimate: boolean;
  target: number;
  prefix: string;
  suffix: string;
  decimals: number;
  useGrouping: boolean;
};

function parseMetricValue(value: string | number): AnimatedMetricValue {
  if (typeof value === "number") {
    return {
      canAnimate: Number.isFinite(value),
      target: value,
      prefix: "",
      suffix: "",
      decimals: Number.isInteger(value) ? 0 : 2,
      useGrouping: true,
    };
  }

  const match = value.trim().match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) {
    return {
      canAnimate: false,
      target: 0,
      prefix: "",
      suffix: "",
      decimals: 0,
      useGrouping: false,
    };
  }

  const numericText = match[2].replace(/,/g, "");
  const target = Number(numericText);

  return {
    canAnimate: Number.isFinite(target),
    target,
    prefix: match[1],
    suffix: match[3],
    decimals: numericText.includes(".") ? numericText.split(".")[1].length : 0,
    useGrouping: match[2].includes(","),
  };
}

function formatMetricValue(metric: AnimatedMetricValue, value: number) {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: metric.decimals,
    maximumFractionDigits: metric.decimals,
    useGrouping: metric.useGrouping,
  }).format(value);

  return `${metric.prefix}${formatted}${metric.suffix}`;
}

export function Metric({ label, value, helper }: MetricProps) {
  const metricValue = useMemo(() => parseMetricValue(value), [value]);
  const [displayValue, setDisplayValue] = useState(() => String(value));

  useEffect(() => {
    if (!metricValue.canAnimate) {
      setDisplayValue(String(value));
      return undefined;
    }

    const controls = animate(0, metricValue.target, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate: (latest) => setDisplayValue(formatMetricValue(metricValue, latest)),
    });

    return () => controls.stop();
  }, [metricValue, value]);

  return (
    <motion.div
      className="motion-card rounded-md border border-zinc-200 bg-white px-4 py-3 shadow-sm"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <motion.p
        key={String(value)}
        className="mt-1 text-2xl font-semibold"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {displayValue}
      </motion.p>
      {helper && <p className="mt-1 text-xs text-zinc-500">{helper}</p>}
    </motion.div>
  );
}
