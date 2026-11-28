import { Trophy } from "lucide-react";

type Node = {
  id: string;
  column: number;
  center: number;
  slots: [string, string];
  next?: string;
};

export type GameRoleBracketOptions = { hasByes: boolean; teamsByPosition?: ReadonlyMap<number, string> };

const cardWidth = 18;
const cardHeight = 40;
const projectedCardHeight = 104;
const trophyTop = 22;
const trophySize = 36;
const headings = ["Cuartos", "Semis", "Final", "Semis", "Cuartos"];
const columnX = (column: number) => column * (100 - cardWidth) / 4;
const pending: [string, string] = ["Por definir", "Por definir"];

function quarterfinalSeeds(hasByes: boolean) {
  return hasByes ? [[4, 5], [1, null], [3, 6], [2, null]] as const
    : [[1, 8], [4, 5], [2, 7], [3, 6]] as const;
}

function rankSlots(pair: readonly [number, number | null], teams?: ReadonlyMap<number, string>): [string, string] {
  const label = (position: number) => {
    const team = teams?.get(position);
    return team ? `${position}.º ${team}` : `${position}${[1, 3].includes(position) ? ".er" : ".º"} lugar`;
  };
  return [label(pair[0]), pair[1] === null ? "Pase directo" : label(pair[1])];
}

function layout({ hasByes, teamsByPosition }: GameRoleBracketOptions) {
  const [q1, q2, q3, q4] = quarterfinalSeeds(hasByes);
  const columns = teamsByPosition
    ? [{ left: 0, width: 27 }, { left: 29, width: 13 }, { left: 44, width: 12 }, { left: 58, width: 13 }, { left: 73, width: 27 }]
    : headings.map((_, index) => ({ left: columnX(index), width: cardWidth }));
  const upper = teamsByPosition ? 79 : 52;
  const lower = teamsByPosition ? 195 : 120;
  const middle = (upper + lower) / 2;
  const nodes: Node[] = [
    { id: "q1", column: 0, center: upper, slots: rankSlots(q1, teamsByPosition), next: "s1" },
    { id: "q2", column: 0, center: lower, slots: rankSlots(q2, teamsByPosition), next: "s1" },
    { id: "s1", column: 1, center: middle, slots: pending, next: "final" },
    { id: "final", column: 2, center: middle, slots: pending },
    { id: "s2", column: 3, center: middle, slots: pending, next: "final" },
    { id: "q3", column: 4, center: upper, slots: rankSlots(q3, teamsByPosition), next: "s2" },
    { id: "q4", column: 4, center: lower, slots: rankSlots(q4, teamsByPosition), next: "s2" },
  ];
  const lines = nodes.flatMap(node => {
    const next = nodes.find(match => match.id === node.next);
    if (!next) return [];
    const forward = node.column < next.column;
    const from = columns[node.column];
    const to = columns[next.column];
    const start = from.left + (forward ? from.width : 0);
    const end = to.left + (forward ? 0 : to.width);
    const mid = (start + end) / 2;
    return [
      { left: Math.min(start, mid), top: node.center, width: Math.abs(mid - start), height: 0 },
      { left: mid, top: Math.min(node.center, next.center), width: 0, height: Math.abs(node.center - next.center) },
      { left: Math.min(mid, end), top: next.center, width: Math.abs(end - mid), height: 0 },
    ];
  });
  return { nodes, lines, columns };
}

const bracketHeight = (options: GameRoleBracketOptions) => options.teamsByPosition ? 253 : 148;
const matchHeight = (node: Node, options: GameRoleBracketOptions) =>
  options.teamsByPosition && (node.column === 0 || node.column === 4) ? projectedCardHeight : cardHeight;

export function GameRoleBracket(options: GameRoleBracketOptions) {
  const { nodes, lines, columns } = layout(options);
  return <div className="game-role-bracket" role="group" aria-label="Llaves de liguilla" style={{ height: bracketHeight(options) }}>
    {headings.map((heading, index) => <strong className="game-role-bracket-stage" key={index}
      style={{ left: `${columns[index].left}%`, width: `${columns[index].width}%` }}>{heading}</strong>)}
    <span className="game-role-bracket-trophy" role="img" aria-label="Trofeo de la final"
      style={{ top: trophyTop, width: trophySize, height: trophySize }}><Trophy aria-hidden="true" /></span>
    {lines.map((line, index) => <span aria-hidden="true" className="game-role-bracket-line" key={index}
      style={{ top: line.top, left: `${line.left}%`, width: `max(1px, ${line.width}%)`, height: Math.max(1, line.height) }} />)}
    {nodes.map(node => {
      const column = columns[node.column];
      const height = matchHeight(node, options);
      return <div className="game-role-bracket-match" role="group" aria-label={headings[node.column]} data-final={node.id === "final"} key={node.id}
        style={{ left: `${column.left}%`, width: `${column.width}%`, top: node.center - height / 2, height }}>
        {node.slots.map((slot, index) => <div className="game-role-bracket-slot" key={index}><span title={slot}>{slot}</span></div>)}
      </div>;
    })}
  </div>;
}

const imageScale = 1.45;
export const bracketImageHeight = (options: GameRoleBracketOptions) => Math.ceil(bracketHeight(options) * imageScale);

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

export function drawGameRoleBracket(ctx: CanvasRenderingContext2D, options: GameRoleBracketOptions, x: number, y: number, width: number) {
  const { nodes, lines, columns } = layout(options);
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "#174734";
  ctx.font = "700 17px system-ui, sans-serif";
  headings.forEach((heading, index) => {
    const { left, width: columnWidth } = columns[index];
    ctx.fillText(heading, x + width * (left + columnWidth / 2) / 100, y, width * columnWidth / 100);
  });
  drawTrophy(ctx, x + width / 2, y + trophyTop * imageScale);
  ctx.fillStyle = "#8eac99";
  for (const line of lines) {
    ctx.fillRect(x + width * line.left / 100, y + line.top * imageScale,
      Math.max(1, width * line.width / 100), Math.max(1, line.height * imageScale));
  }
  for (const node of nodes) {
    const column = columns[node.column];
    const matchWidth = width * column.width / 100;
    const left = x + width * column.left / 100;
    const top = y + (node.center - matchHeight(node, options) / 2) * imageScale;
    const slotHeight = matchHeight(node, options) * imageScale / 2;
    const final = node.id === "final";
    ctx.beginPath();
    ctx.roundRect(left, top, matchWidth, slotHeight * 2, 6);
    ctx.fillStyle = final ? "#e8f3ec" : "#fff";
    ctx.fill();
    ctx.strokeStyle = final ? "#246343" : "#b8cdbf";
    ctx.stroke();
    ctx.fillStyle = "#dce5df";
    ctx.fillRect(left + 5, top + slotHeight, matchWidth - 10, 1);
    ctx.fillStyle = "#174734";
    ctx.font = "600 14px system-ui, sans-serif";
    node.slots.forEach((slot, index) => {
      const maxWidth = matchWidth - 8;
      const lines = slot.split(/\s+/).reduce<string[]>((lines, word) => {
        const previous = lines.at(-1);
        if (previous && ctx.measureText(`${previous} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${previous} ${word}`;
        else lines.push(word);
        return lines;
      }, []);
      const lineHeight = Math.min(15, (slotHeight - 4) / lines.length);
      ctx.font = `600 ${Math.min(14, lineHeight)}px system-ui, sans-serif`;
      const start = top + index * slotHeight + (slotHeight - lines.length * lineHeight) / 2;
      lines.forEach((line, row) => ctx.fillText(line, left + matchWidth / 2, start + row * lineHeight, maxWidth));
      ctx.font = "600 14px system-ui, sans-serif";
    });
  }
  ctx.restore();
}
