import type { StudentAssessment } from "../../types";

export function RadarChart({ assessment }: { assessment: StudentAssessment }) {
  const stats = [
    ["PAC", assessment.pace],
    ["SHO", assessment.shooting],
    ["PAS", assessment.passing],
    ["DRI", assessment.dribbling],
    ["DEF", assessment.defense],
    ["PHY", assessment.physical],
  ] as const;
  const center = 110;
  const radius = 76;
  const points = stats.map(([, value], index) => {
    const angle = (Math.PI * 2 * index) / stats.length - Math.PI / 2;
    const scaled = radius * (Number(value) / 100);
    return `${center + Math.cos(angle) * scaled},${center + Math.sin(angle) * scaled}`;
  }).join(" ");
  const axisPoints = stats.map(([label], index) => {
    const angle = (Math.PI * 2 * index) / stats.length - Math.PI / 2;
    return { label, x: center + Math.cos(angle) * (radius + 22), y: center + Math.sin(angle) * (radius + 22), lineX: center + Math.cos(angle) * radius, lineY: center + Math.sin(angle) * radius };
  });

  return (
    <svg viewBox="0 0 220 220" className="mx-auto h-56 w-56">
      {[0.33, 0.66, 1].map((scale) => (
        <polygon
          key={scale}
          points={stats.map(([,], index) => {
            const angle = (Math.PI * 2 * index) / stats.length - Math.PI / 2;
            return `${center + Math.cos(angle) * radius * scale},${center + Math.sin(angle) * radius * scale}`;
          }).join(" ")}
          fill="none"
          stroke="#d4d4d8"
        />
      ))}
      {axisPoints.map((point) => (
        <g key={point.label}>
          <line x1={center} y1={center} x2={point.lineX} y2={point.lineY} stroke="#e4e4e7" />
          <text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-500 text-[10px] font-semibold">{point.label}</text>
        </g>
      ))}
      <polygon points={points} fill="#67e8f9" fillOpacity="0.58" stroke="#0891b2" strokeWidth="2" className="transition-all duration-500" />
      <circle cx={center} cy={center} r="3" fill="#0891b2" />
    </svg>
  );
}
