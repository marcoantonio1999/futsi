import { Trophy } from "lucide-react";

type Node = {
  id: string;
  column: number;
  center: number;
  slots: [string, string];
  next?: string;
};

const height = 148;
const cardWidth = 18;
const cardHeight = 40;
const trophyTop = 22;
const trophySize = 36;
const headings = ["Cuartos", "Semis", "Final", "Semis", "Cuartos"];
const columnX = (column: number) => column * (100 - cardWidth) / 4;
const pending: [string, string] = ["Por definir", "Por definir"];

function layout(hasByes: boolean) {
  const nodes: Node[] = [
    { id: "q1", column: 0, center: 52, slots: hasByes ? ["4.º lugar", "5.º lugar"] : ["1.er lugar", "8.º lugar"], next: "s1" },
    { id: "q2", column: 0, center: 120, slots: hasByes ? ["1.er lugar", "Pase directo"] : ["4.º lugar", "5.º lugar"], next: "s1" },
    { id: "s1", column: 1, center: 86, slots: pending, next: "final" },
    { id: "final", column: 2, center: 86, slots: pending },
    { id: "s2", column: 3, center: 86, slots: pending, next: "final" },
    { id: "q3", column: 4, center: 52, slots: hasByes ? ["3.er lugar", "6.º lugar"] : ["2.º lugar", "7.º lugar"], next: "s2" },
    { id: "q4", column: 4, center: 120, slots: hasByes ? ["2.º lugar", "Pase directo"] : ["3.er lugar", "6.º lugar"], next: "s2" },
  ];
  const lines = nodes.flatMap(node => {
    const next = nodes.find(match => match.id === node.next);
    if (!next) return [];
    const forward = node.column < next.column;
    const start = columnX(node.column) + (forward ? cardWidth : 0);
    const end = columnX(next.column) + (forward ? 0 : cardWidth);
    const mid = (start + end) / 2;
    return [
      { left: Math.min(start, mid), top: node.center, width: Math.abs(mid - start), height: 0 },
      { left: mid, top: Math.min(node.center, next.center), width: 0, height: Math.abs(node.center - next.center) },
      { left: Math.min(mid, end), top: next.center, width: Math.abs(end - mid), height: 0 },
    ];
  });
  return { nodes, lines };
}

export function GameRoleBracket({ hasByes }: { hasByes: boolean }) {
  const { nodes, lines } = layout(hasByes);
  return <div className="game-role-bracket" role="group" aria-label="Llaves de liguilla" style={{ height }}>
    {headings.map((heading, index) => <strong className="game-role-bracket-stage" key={index}
      style={{ left: `${columnX(index)}%`, width: `${cardWidth}%` }}>{heading}</strong>)}
    <span className="game-role-bracket-trophy" role="img" aria-label="Trofeo de la final"
      style={{ top: trophyTop, width: trophySize, height: trophySize }}><Trophy aria-hidden="true" /></span>
    {lines.map((line, index) => <span aria-hidden="true" className="game-role-bracket-line" key={index}
      style={{ top: line.top, left: `${line.left}%`, width: `max(1px, ${line.width}%)`, height: Math.max(1, line.height) }} />)}
    {nodes.map(node => <div className="game-role-bracket-match" role="group" aria-label={headings[node.column]} data-final={node.id === "final"} key={node.id}
      style={{ left: `${columnX(node.column)}%`, width: `${cardWidth}%`, top: node.center - cardHeight / 2, minHeight: cardHeight }}>
      {node.slots.map((slot, index) => <span key={index}>{slot}</span>)}
    </div>)}
  </div>;
}

const imageScale = 1.45;
export const bracketImageHeight = Math.ceil(height * imageScale);

const trophyOutline = new Path2D("M7 4h10v5a5 5 0 0 1-10 0V4Zm0 2H4v2a3 3 0 0 0 3 3m10-5h3v2a3 3 0 0 1-3 3m-5 3v5m-4 1h8");
const trophyCup = new Path2D("M7 4h10v5a5 5 0 0 1-10 0V4Z");

function drawTrophy(ctx: CanvasRenderingContext2D, center: number, top: number) {
  const radius = trophySize * imageScale / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, top + radius, radius - 1, 0, 2 * Math.PI);
  ctx.fillStyle = "#fff6dc";
  ctx.fill();
  ctx.strokeStyle = "#e9d29c";
  ctx.stroke();
  const iconSize = radius * 1.45;
  ctx.translate(center - iconSize / 2, top + radius - iconSize / 2);
  ctx.scale(iconSize / 24, iconSize / 24);
  ctx.fillStyle = "#f4ca69";
  ctx.fill(trophyCup);
  ctx.strokeStyle = "#8c621b";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(trophyOutline);
  ctx.restore();
}

export function drawGameRoleBracket(ctx: CanvasRenderingContext2D, hasByes: boolean, x: number, y: number, width: number) {
  const { nodes, lines } = layout(hasByes);
  const matchWidth = width * cardWidth / 100;
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#174734";
  ctx.font = "700 17px system-ui, sans-serif";
  headings.forEach((heading, index) => ctx.fillText(heading, x + width * columnX(index) / 100 + matchWidth / 2, y, matchWidth));
  drawTrophy(ctx, x + width / 2, y + trophyTop * imageScale);
  ctx.fillStyle = "#8eac99";
  for (const line of lines) {
    ctx.fillRect(x + width * line.left / 100, y + line.top * imageScale,
      Math.max(1, width * line.width / 100), Math.max(1, line.height * imageScale));
  }
  for (const node of nodes) {
    const left = x + width * columnX(node.column) / 100;
    const top = y + (node.center - cardHeight / 2) * imageScale;
    const final = node.id === "final";
    ctx.beginPath();
    ctx.roundRect(left, top, matchWidth, cardHeight * imageScale, 6);
    ctx.fillStyle = final ? "#e8f3ec" : "#fff";
    ctx.fill();
    ctx.strokeStyle = final ? "#246343" : "#b8cdbf";
    ctx.stroke();
    ctx.fillStyle = "#dce5df";
    ctx.fillRect(left + 5, top + cardHeight * imageScale / 2, matchWidth - 10, 1);
    ctx.fillStyle = "#174734";
    ctx.font = "600 14px system-ui, sans-serif";
    node.slots.forEach((slot, index) => ctx.fillText(slot, left + matchWidth / 2, top + 6 + index * 29, matchWidth - 8));
  }
  ctx.restore();
}
