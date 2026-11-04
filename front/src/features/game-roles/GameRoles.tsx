import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "../../api";
import { Button, Card, Dialog, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, Tournament } from "../../types";
import { useEnrollmentScrollReady, useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import "./gameRoles.css";

type Team = { id: number; name: string; is_active: boolean };
type Round = { id: number; number: number; starts_on: string };
type Cross = { home_team_id: number; away_team_id: number; round_id: number };
type Matrix = { teams: Team[]; rounds: Round[]; crosses: Cross[]; starts_on: string | null };
type Editor = { kind: "round"; round?: Round } | { kind: "cross"; home: Team; away: Team; current?: Round };

function addDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

const dateLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function weekLabel(start: string) {
  return dateLabel.formatRange(new Date(start + "T00:00:00Z"), new Date(addDays(start, 6) + "T00:00:00Z"));
}

export function GameRoles({ token, tournaments, sites, loading }: {
  token: string; tournaments: Tournament[]; sites: Pick<Site, "id" | "name">[]; loading: boolean;
}) {
  const [tournamentId, setTournamentId] = useEnrollmentViewState("gameRoles.tournament", "");
  const tournament = tournaments.find(row => String(row.id) === tournamentId);
  return <>
    <Card as="section" className="operator-controls game-roles-intro">
      <Label><span id="game-roles-tournament-label">Torneo</span><NativeSelect aria-labelledby="game-roles-tournament-label"
        value={tournament?.id ?? ""} disabled={loading} onChange={event => setTournamentId(event.target.value)}>
        <option value="">{loading ? "Cargando torneos…" : "Selecciona un torneo"}</option>
        {tournaments.map(row => <option key={row.id} value={row.id}>
          {row.name} · {sites.find(site => site.id === row.site)?.name}{row.is_active ? "" : " · Inactivo"}
        </option>)}
      </NativeSelect></Label>
    </Card>
    {tournament && <TournamentMatrix key={tournament.id} token={token} tournamentId={tournament.id} />}
  </>;
}

function TournamentMatrix({ token, tournamentId }: { token: string; tournamentId: number }) {
  const path = `/player-enrollments/game-roles/${tournamentId}/`;
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useEnrollmentViewState(`gameRoles.round.${tournamentId}`, 0);
  const [editor, setEditor] = useState<Editor | null>(null);
  useEnrollmentScrollReady(Boolean(matrix));

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    apiRequest<Matrix>(path, token, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setMatrix(result); })
      .catch(reason => { if (!controller.signal.aborted) setLoadError(reason.message); });
    return () => controller.abort();
  }, [path, token, reload]);

  if (loadError) return <Card as="section" className="operator-controls">
    <p className="error" role="alert">{loadError}</p><Button onClick={() => setReload(value => value + 1)}>Volver a cargar matriz</Button>
  </Card>;
  if (!matrix) return <p role="status">Cargando matriz…</p>;

  const selected = matrix.rounds.find(round => round.id === selectedId) ?? matrix.rounds[0];
  const roundById = new Map(matrix.rounds.map(round => [round.id, round]));
  const crossByTeams = new Map(matrix.crosses.map(cross => [`${cross.home_team_id}:${cross.away_team_id}`, roundById.get(cross.round_id)]));
  const counts = new Map<number, number>();
  for (const cross of matrix.crosses) counts.set(cross.round_id, (counts.get(cross.round_id) ?? 0) + 1);
  const crosses = selected ? counts.get(selected.id) ?? 0 : 0;

  async function save(method: string, data: object, roundNumber?: number) {
    const result = await apiRequest<Matrix>(path, token, { method, body: JSON.stringify(data) });
    setMatrix(result);
    if (roundNumber !== undefined) setSelectedId(result.rounds.find(round => round.number === roundNumber)?.id ?? 0);
    setEditor(null);
  }

  return <div className="game-roles-workspace">
    <Card as="aside" className="game-roles-rounds" aria-labelledby="game-roles-rounds-title">
      <h2 id="game-roles-rounds-title">Jornadas</h2>
      <Button type="button" className="primary" onClick={() => setEditor({ kind: "round" })}>Agregar jornada</Button>
      {selected ? <>
        <Label className="game-roles-round-select"><span id="game-roles-visible-round-label">Jornada visible</span>
          <NativeSelect aria-labelledby="game-roles-visible-round-label" value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}>
            {matrix.rounds.map(round => <option key={round.id} value={round.id}>Jornada {round.number}</option>)}
          </NativeSelect>
        </Label>
        <div className="game-roles-round-list">
          {matrix.rounds.map(round => <Button key={round.id} type="button" aria-pressed={round.id === selected.id} onClick={() => setSelectedId(round.id)}>
            <strong>Jornada {round.number}</strong><span>{weekLabel(round.starts_on)}</span>
          </Button>)}
        </div>
        <p className="game-roles-mobile-week">{weekLabel(selected.starts_on)}</p>
        <Button type="button" onClick={() => setEditor({ kind: "round", round: selected })}>Editar jornada {selected.number}</Button>
      </> : <p>Agrega la primera jornada para asignar cruces.</p>}
    </Card>

    <Card as="section" className="game-roles-matrix" aria-labelledby="game-roles-matrix-title">
      <h2 id="game-roles-matrix-title">Matriz de equipos</h2>
      <p>Los locales están en las columnas y los visitantes en las filas. Selecciona una celda para asignar o cambiar su jornada.</p>
      {selected && <p className="game-roles-selection" role="status"><strong>Jornada {selected.number}</strong> · {crosses} {crosses === 1 ? "cruce" : "cruces"}</p>}
      {matrix.teams.length < 2 ? <p>El torneo necesita al menos dos equipos para asignar cruces.</p> :
        <div className="game-roles-grid-scroll" role="region" aria-label="Matriz de cruces por equipo" tabIndex={0}>
          <table className="game-roles-grid">
            <thead><tr><th>Visitante / Local</th>{matrix.teams.map(team => <th key={team.id} scope="col">{team.name}{!team.is_active && <small>Inactivo</small>}</th>)}</tr></thead>
            <tbody>{matrix.teams.map(away => <tr key={away.id}>
              <th scope="row">{away.name}{!away.is_active && <small>Inactivo</small>}</th>
              {matrix.teams.map(home => {
                if (home.id === away.id) return <td key={home.id} className="game-roles-diagonal">—</td>;
                const current = crossByTeams.get(`${home.id}:${away.id}`);
                return <td key={home.id}><Button type="button" className="game-roles-cell" disabled={!selected}
                  data-highlighted={Boolean(selected && current?.id === selected.id)}
                  aria-label={`${home.name} local, ${away.name} visitante, ${current ? "jornada " + current.number : "sin jornada"}`}
                  onClick={() => setEditor({ kind: "cross", home, away, current })}>
                  {current?.number ?? "+"}
                </Button></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>}
    </Card>
    {editor && <MatrixEditor editor={editor} matrix={matrix} selected={selected} onClose={() => setEditor(null)} onSave={save} />}
  </div>;
}

function MatrixEditor({ editor, matrix, selected, onClose, onSave }: {
  editor: Editor; matrix: Matrix; selected: Round | undefined; onClose: () => void;
  onSave: (method: string, data: object, roundNumber?: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const last = matrix.rounds.at(-1);
  const round = editor.kind === "round" ? editor.round : undefined;
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (editor.kind === "cross") {
        const roundId = form.get("round_id");
        await onSave("PUT", { home_team_id: editor.home.id, away_team_id: editor.away.id, round_id: roundId ? Number(roundId) : null });
      } else {
        const number = Number(form.get("number"));
        await onSave(round ? "PATCH" : "POST", { round_id: round?.id, number, starts_on: form.get("starts_on") }, number);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <Dialog ref={dialog} className="game-roles-dialog" aria-labelledby="game-roles-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="game-roles-dialog-title">{editor.kind === "cross" ? "Asignar jornada al cruce" : round ? "Editar jornada" : "Agregar jornada"}</h2>
      {editor.kind === "cross" ? <>
        <p><strong>{editor.home.name}</strong> (local) vs. <strong>{editor.away.name}</strong> (visitante)</p>
        <Label><span id="game-roles-cross-round-label">Jornada</span><NativeSelect aria-labelledby="game-roles-cross-round-label"
          name="round_id" defaultValue={editor.current?.id ?? selected?.id ?? ""}>
          <option value="">Sin jornada</option>
          {matrix.rounds.map(row => <option key={row.id} value={row.id}>Jornada {row.number}</option>)}
        </NativeSelect></Label>
      </> : <>
        <Label>Número de jornada<Input type="number" name="number" min={1} max={999} required defaultValue={round?.number ?? Math.min(999, (last?.number ?? 0) + 1)} /></Label>
        <Label>Inicio de la semana<Input type="date" name="starts_on" required defaultValue={round?.starts_on ?? (last ? addDays(last.starts_on, 7) : matrix.starts_on ?? "")} /></Label>
        <p>La jornada abarca siete días desde la fecha de inicio.</p>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        <Button type="button" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
      </footer>
    </form>
  </Dialog>;
}
