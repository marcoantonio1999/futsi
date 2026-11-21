import { roleTimeLabel } from "./roleSchedule";
import bpowerLogo from "../enrollments/assets/bpower-roster-watermark.png";
import { GameRoleBracket, bracketImageHeight, drawGameRoleBracket } from "./GameRoleBracket";
import type { StandingRow } from "../../types";

export type Match = {
  scheduled_on: string | null; starts_at: string | null; ends_at: string | null; played: boolean;
  home_team__name: string; away_team__name: string; home_goals?: number | null; away_goals?: number | null;
};
export type Schedule = {
  tournament: string; site: string; number: number; starts_on: string; matches: Match[];
  expected_weeks?: number | null;
  results_round?: number | null; results?: Match[];
  standings?: StandingRow[]; scoring?: { team: string; goals: number }[];
};

type Row = (string | number)[];
type Block = {
  title: string;
  columns?: string[];
  widths?: number[];
  rows: Row[];
  empty?: string;
  qualified?: number;
  standings?: boolean;
  bracket?: { hasByes: boolean };
};

const dayLabel = new Intl.DateTimeFormat("es-MX", {
  weekday: "long", day: "numeric", month: "short", timeZone: "UTC",
});
export const dayName = (day: string) => dayLabel.format(new Date(day + "T00:00:00Z"));

function reportColumns(schedule: Schedule): [Block[], Block[]] {
  const name = schedule.tournament.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const league = /^(premier|nocturno|espanola|uefa|eurocopa)(?:\s|$)/.exec(name)?.[1];
  const franco = schedule.site.trim().toLowerCase() === "colegio franco" && Boolean(league);
  const euro = league === "eurocopa";
  const competition = franco ? [
    ["Clasificación por tabla de posiciones general."],
    [schedule.expected_weeks
      ? `Torneo regular de ${schedule.expected_weeks} ${schedule.expected_weeks === 1 ? "jornada" : "jornadas"}. Califican del 1ero al 8to.`
      : "Califican del 1ero al 8to."],
    ...(euro ? [] : [[`Fecha límite para registrar: Jornada ${league === "uefa" ? 15 : 9} del torneo.`]]),
    ["Equipos con adeudos quedan automáticamente descalificados."],
  ] : [];
  const standings = schedule.standings ?? [];
  return [
    [
      { title: "Sistema de Competencia", rows: competition, empty: "Reglas por confirmar." },
      { title: "LIGUILLA", rows: [], bracket: franco ? { hasByes: euro } : undefined, empty: "Formato por confirmar." },
      { title: schedule.results_round ? `Resultados · Jornada ${schedule.results_round}` : "Resultados",
        columns: ["Local", "Marcador", "Visitante"], widths: [2, 1, 2],
        rows: (schedule.results ?? schedule.matches.filter(match => match.played)).map(match => [
          match.home_team__name, match.home_goals == null || match.away_goals == null ? "—" : `${match.home_goals}–${match.away_goals}`, match.away_team__name,
        ]), empty: "Todavía no hay resultados." },
      { title: "Próximos Partidos", columns: ["Fecha", "Horario", "Local", "Visitante"], widths: [2, 1.5, 2, 2],
        rows: schedule.matches.filter(match => !match.played && match.scheduled_on).map(match =>
          [dayName(match.scheduled_on!), roleTimeLabel(schedule.tournament, match.starts_at, match.ends_at), match.home_team__name, match.away_team__name]),
        empty: "Todavía no hay próximos partidos para esta jornada." },
      { title: "DESCANSO", rows: [], empty: "—" },
    ],
    [
      { title: "Tabla de Posiciones", standings: true, columns: ["P", "Equipo", "JJ", "JG", "JP", "JE", "GF", "GC", "DG", "PTS"],
        widths: [1, 5, 1, 1, 1, 1, 1, 1, 1, 1.2],
        rows: standings.map(row => [row.position, row.team_name, row.played, row.won, row.lost, row.drawn,
          row.goals_for, row.goals_against, row.goal_difference, row.points]),
        qualified: franco && standings.some(row => row.played > 0) ? 8 : 0, empty: "Aún no hay equipos." },
      { title: "Tabla de Goleo", columns: ["P", "Equipo", "GF"], widths: [1, 5, 1],
        rows: (schedule.scoring ?? []).slice(0, 5).map((row, i) => [i + 1, row.team, row.goals]),
        empty: "Todavía no hay marcadores registrados." },
    ],
  ];
}

const zoneColors = {
  qualified: { row: "#edf7ef", label: "#d9eddf", points: "#dcefe1", text: "#245b39" },
  outside: { row: "#fff0ef", label: "#f8dedc", points: "#f8dedc", text: "#943934" },
};

function reportRows(block: Block) {
  return block.rows.flatMap((values, index) => {
    const zone = block.qualified ? (index < block.qualified ? "qualified" : "outside") : null;
    const label = zone === "qualified" && index === 0 ? `Zona de clasificación · 1.º a ${block.qualified}.º`
      : zone === "outside" && index === block.qualified ? `Fuera de zona · ${index + 1}.º en adelante` : "";
    const row = { values, zone, isLabel: false, cutoff: index + 1 === block.qualified && index + 1 < block.rows.length } as const;
    return label ? [{ ...row, values: [label], isLabel: true, cutoff: false }, row] : [row];
  });
}

function ReportBlock({ block }: { block: Block }) {
  return <section className="game-role-report-block" data-standings={block.standings}>
    <h2>{block.title}</h2>
    {block.bracket ? <GameRoleBracket hasByes={block.bracket.hasByes} /> : block.columns ? <table>
      {block.widths && <colgroup>{block.widths.map((width, index, widths) =>
        <col key={index} style={{ width: `${width / widths.reduce((sum, value) => sum + value, 0) * 100}%` }} />)}
      </colgroup>}
      <thead><tr>{block.columns.map((column, i) => <th scope="col" key={i}>{column}</th>)}</tr></thead>
      <tbody>{block.rows.length ? reportRows(block).map(({ values, zone, isLabel, cutoff }, i) =>
        <tr key={i} data-zone={zone ?? undefined} data-zone-label={isLabel || undefined} data-cutoff={cutoff}>
          {isLabel ? <td colSpan={block.columns!.length}>{values[0]}</td>
            : values.map((cell, j) => <td key={j}>{cell}</td>)}
        </tr>) : <tr><td colSpan={block.columns.length}>{block.empty}</td></tr>}</tbody>
    </table> : block.rows.length ? block.rows.map(([line]) => <p key={line}>{line}</p>) : <p>{block.empty}</p>}
  </section>;
}

const social = "www.facebook.com/supergol.bosques";
const facebookBlue = "#0866ff";
const facebookMark = "M14.4 23v-9.4h3.1l.5-3.6h-3.6V7.7c0-1 .3-1.8 1.8-1.8h1.9V2.7c-.3 0-1.5-.2-2.8-.2-2.8 0-4.8 1.7-4.8 4.9V10H7.3v3.6h3.2V23Z";


export function ScheduleSheet({ schedule, live = false }: { schedule: Schedule; live?: boolean }) {
  return <article className="game-role-sheet">
    <div className="game-role-report-watermark" style={{ backgroundImage: `url(${bpowerLogo})` }} aria-hidden="true" />
    <header>
      <img src={bpowerLogo} alt="BPower" />
      <div>
        {live && <span className="game-role-live">En vivo</span>}
        <h1>{schedule.tournament}</h1><p>Jornada {schedule.number} · {schedule.site}</p>
      </div>
    </header>
    <div className="game-role-report-grid">
      {reportColumns(schedule).map((blocks, i) => <div key={i}>
        {blocks.map(block => <ReportBlock key={block.title} block={block} />)}
      </div>)}
    </div>
    {schedule.site.trim().toLowerCase() === "colegio franco" && <footer className="game-role-report-social">
      <svg className="game-role-report-facebook" aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
        <circle cx="12" cy="12" r="12" fill={facebookBlue} />
        <path d={facebookMark} fill="#fff" />
      </svg>
      <span>Síguenos en Facebook <a href={`https://${social}`} target="_blank" rel="noreferrer">{social}</a></span>
    </footer>}
  </article>;
}

export async function renderScheduleImage(schedule: Schedule) {
  const logo = new Image();
  logo.src = bpowerLogo;
  await logo.decode();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo crear la imagen.");
  const width = 1240, padding = 34, gap = 24, inset = 12;
  const columnWidth = (width - 2 * padding - gap) / 2;
  const contentWidth = columnWidth - 2 * inset;
  const columns = reportColumns(schedule);
  const font = "21px system-ui, sans-serif";
  ctx.font = font;
  function wrap(text: string, max: number) {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx!.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    return [...lines, line];
  }
  const prepared = columns.map(blocks => blocks.map(block => {
    if (block.bracket) return { block, rows: [], height: 49 + inset + bracketImageHeight };
    const units = block.widths ?? [1];
    const sizes = units.map(unit => contentWidth * unit / units.reduce((a, b) => a + b));
    const rows = [
      ...(block.columns ? [{ values: block.columns, sizes, fill: block.standings ? "#246343" : "#f0f4f2", heading: true, cutoff: false, zone: null, isLabel: false }] : []),
      ...reportRows(block).map(row => ({
        ...row, sizes: row.isLabel ? [contentWidth] : sizes, heading: false,
        fill: row.zone ? zoneColors[row.zone][row.isLabel ? "label" : "row"] : null,
      })),
      ...(!block.rows.length ? [{ values: [block.empty ?? "—"], sizes: [contentWidth], fill: null, heading: false, cutoff: false, zone: null, isLabel: false }] : []),
    ].map(row => {
      const cells = row.values.map((value, i) => wrap(String(value), row.sizes[i] - 12));
      return { ...row, cells, height: Math.max(...cells.map(cell => cell.length)) * 27 + 12 };
    });
    return { block, rows, height: 49 + inset + rows.reduce((sum, row) => sum + row.height, 0) };
  }));
  const bodyHeight = Math.max(...prepared.map(blocks => blocks.reduce((sum, block) => sum + block.height + gap, 0)));
  const showSocial = schedule.site.trim().toLowerCase() === "colegio franco";
  canvas.width = width;
  canvas.height = 135 + bodyHeight + (showSocial ? 44 : 0);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, canvas.height);
  const logoRatio = logo.naturalHeight / logo.naturalWidth;
  const watermarkWidth = Math.min(width * 1.3, canvas.height * 0.88 / logoRatio);
  const watermarkHeight = watermarkWidth * logoRatio;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.045;
  ctx.drawImage(logo, (width - watermarkWidth) / 2, (canvas.height - watermarkHeight) / 2, watermarkWidth, watermarkHeight);
  ctx.globalAlpha = 1;
  ctx.drawImage(logo, padding - 8, (114 - 122 * logoRatio) / 2, 122, 122 * logoRatio);
  ctx.restore();
  ctx.fillStyle = "#173629";
  ctx.font = "700 37px system-ui, sans-serif";
  ctx.fillText(schedule.tournament, 151, 19, width - 181);
  ctx.font = font;
  ctx.fillStyle = "#53675c";
  ctx.fillText(`Jornada ${schedule.number} · ${schedule.site}`, 151, 67, width - 181);
  ctx.fillStyle = "#dce5df";
  ctx.fillRect(padding, 113, width - 2 * padding, 1);
  for (const [index, blocks] of prepared.entries()) {
    const x = padding + index * (columnWidth + gap);
    let y = 135;
    for (const { block, rows, height } of blocks) {
      ctx.beginPath();
      ctx.roundRect(x, y, columnWidth, height, 10);
      ctx.fillStyle = "rgba(255, 255, 255, .35)";
      ctx.fill();
      ctx.strokeStyle = block.standings ? "#a5bdae" : "#dce5df";
      ctx.stroke();
      ctx.font = "700 23px system-ui, sans-serif";
      ctx.fillStyle = "#174734";
      ctx.fillText(block.title, x + inset, y + 12, contentWidth);
      y += 49;
      if (block.bracket) {
        drawGameRoleBracket(ctx, block.bracket.hasByes, x + inset, y, contentWidth);
        y += bracketImageHeight;
      }
      for (const row of rows) {
        if (row.fill) {
          ctx.fillStyle = row.fill;
          ctx.fillRect(x + inset, y, contentWidth, row.height);
        }
        let cellX = x + inset;
        row.cells.forEach((cell, i) => {
          const ranking = block.standings && !row.heading && row.cells.length > 1;
          const points = ranking && i === row.cells.length - 1;
          if (points) {
            ctx.fillStyle = row.zone ? zoneColors[row.zone].points : "#edf7ef";
            ctx.fillRect(cellX, y, row.sizes[i], row.height);
          }
          ctx.font = row.isLabel || points || (ranking && i < 2) ? `700 ${font}` : font;
          ctx.fillStyle = block.standings && row.heading ? "#fff" : row.zone && (row.isLabel || i === 0 || points) ? zoneColors[row.zone].text : "#173629";
          cell.forEach((line, j) => ctx.fillText(line, cellX + 6, y + 6 + 27 * j, row.sizes[i] - 12));
          cellX += row.sizes[i];
        });
        y += row.height;
        ctx.fillStyle = row.cutoff ? "#ae892e" : "#dce5df";
        ctx.fillRect(x + inset, y - 1, contentWidth, row.cutoff ? 2 : 1);
      }
      y += inset + gap;
    }
  }
  if (showSocial) {
    ctx.fillStyle = "#174734";
    ctx.font = font;
    const socialTop = 135 + bodyHeight;
    ctx.fillText(`Síguenos en Facebook · ${social}`, padding + 34, socialTop);
    ctx.save();
    ctx.translate(padding, socialTop);
    ctx.beginPath();
    ctx.arc(12, 12, 12, 0, 2 * Math.PI);
    ctx.fillStyle = facebookBlue;
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fill(new Path2D(facebookMark));
    ctx.restore();
  }
  return canvas;
}
