import { useEffect, useRef, useState } from "react";
import { RefreshCw, LogOut, Trophy, UsersRound, ClipboardList, Send, ListChecks, CirclePlus, UserPlus } from "lucide-react";
import { API_URL, apiRequest } from "../../api";
import "./enrollments.css";
import "./enrollmentAdmin.css";
import type { AppData, User, Team, Tournament, Site, StudentDeletionConfirmation, StudentDeletionResult } from "../../types";
import { emptyData } from "../../appState";
import { TournamentsPanel, type TournamentSection } from "../tournaments";
import { CameraCapture } from "./CameraCapture";

const labels: Record<string, string> = {
  player_photo: "Foto del jugador", ine_front: "INE frente", ine_back: "INE reverso",
  identity_document: "Pasaporte / cartilla", minor_credential: "Credencial del menor", curp: "CURP",
  guardian_ine_front: "INE del tutor frente", guardian_ine_back: "INE del tutor reverso",
  player_signature: "Firma del jugador", guardian_signature: "Firma del tutor",
};
const ENROLLMENT_FILE_MAX_BYTES = 20_000_000;
type Document = { id: number; kind: string };
type Enrollment = {
  id: number; name: string; birth_date: string; team: string; tournament: string; team_id: number | null; tournament_id: number | null;
  phone: string; phone_secondary: string; guardian_name: string; signed_at: string;
  terms_text: string[]; documents: Document[];
};
type Defaults = { team: string; tournament: string; terms: string[] };
type EnrollmentCatalog = { sites: Pick<Site, "id" | "name">[]; tournaments: Tournament[]; teams: Pick<Team, "id" | "name" | "tournament" | "is_active">[]; deletable_tournament_ids?: number[] };

export function EnrollmentLogin({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Inscripciones BPower"; }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(API_URL + "/auth/login/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "No se pudo iniciar sesión.");
      onLogin(body.token, body.user);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo iniciar sesión."); }
    finally { setBusy(false); }
  }
  return <main className="enrollment-page"><form className="registration-sheet" style={{ maxWidth: 440, marginTop: 60 }} onSubmit={submit}>
    <h1>Inscripciones BPower</h1>{error && <p role="alert" className="error">{error}</p>}
    <label>Usuario<input name="username" autoComplete="username" required /></label>
    <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
    <button className="primary" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
  </form></main>;
}

export function under18(date: string, today = new Date()) {
  if (!date) return false;
  const [year, month, day] = date.split("-").map(Number);
  return today.getFullYear() - year - (today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0) < 18;
}

function Signature({ label, onChange }: { label: string; onChange: (blob: Blob | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const previous = useRef<[number, number] | null>(null);
  function point(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - bounds.left) * 600 / bounds.width, (event.clientY - bounds.top) * 180 / bounds.height];
  }
  return <section className="signature-box">
    <p>{label}</p>
    <canvas ref={canvas} width={600} height={180} aria-label={label}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true; previous.current = point(event);
      }}
      onPointerMove={event => {
        if (!drawing.current || !previous.current) return;
        const ctx = event.currentTarget.getContext("2d"), next = point(event);
        if (ctx) {
          ctx.strokeStyle = "#111"; ctx.lineWidth = 3; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(...previous.current); ctx.lineTo(...next); ctx.stroke();
        }
        previous.current = next;
      }}
      onPointerUp={() => { drawing.current = false; canvas.current?.toBlob(onChange, "image/png"); }}
      onPointerCancel={() => { drawing.current = false; canvas.current?.toBlob(onChange, "image/png"); }}
    />
    <button type="button" className="quiet" onClick={() => {
      canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 180); onChange(null);
    }}>Borrar firma</button>
  </section>;
}

function Upload({ label, photo = false, onChange }: {
  label: string; photo?: boolean; onChange: (file: File | null) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [name, setName] = useState(""), [preview, setPreview] = useState("");
  const previewRef = useRef("");
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  function select(file: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = file?.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    previewRef.current = url; setPreview(url); setName(file?.name || ""); onChange(file);
  }
  return <section className={"upload-box " + (photo ? "player-photo" : "")}>
    <p>{label}</p>
    {photo && <small>Sin lentes, gorras u objetos que tapen la cara.</small>}
    {preview && <img src={preview} alt={label + " adjunta"} />}
    <div className="upload-actions">
      <button type="button" onClick={() => upload.current?.click()}>Adjuntar</button>
      <button type="button" onClick={() => setCameraOpen(true)}>Tomar foto</button>
    </div>
    <input ref={upload} type="file" hidden accept={photo ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"}
      onChange={event => select(event.target.files?.[0] || null)} />
    {cameraOpen && <CameraCapture selfie={photo} onClose={() => setCameraOpen(false)}
      onCapture={file => { select(file); setCameraOpen(false); }} />}
    <small>{name || (photo ? "JPG o PNG · máximo 20 MB" : "JPG, PNG o PDF · máximo 20 MB")}</small>
  </section>;
}

function Terms({ items, guardian, player }: { items: string[]; guardian?: string; player?: string }) {
  return <section className="commitments">
    <h2>Compromisos Generales</h2>
    {items.map((text, index) => <p key={index}>{text}</p>)}
    {guardian && <p>Yo {guardian}, como tutor de {player || "el menor"}, autorizo la participación del menor,
      deslindando de toda responsabilidad a la liga, al club, al colegio y a su personal.</p>}
  </section>;
}

export function PublicPlayerEnrollment({ invitation }: { invitation: string }) {
  const [step, setStep] = useState(0), [accepted, setAccepted] = useState(false);
  const [birthDate, setBirthDate] = useState(""), minor = under18(birthDate);
  const [identity, setIdentity] = useState("ine");
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [files, setFiles] = useState<Record<string, Blob | null>>({});
  const [error, setError] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const today = new Date();
  const maxDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  useEffect(() => {
    document.title = "Inscripción BPower";
    let active = true;
    fetch(API_URL + "/player-enrollments/public/" + encodeURIComponent(invitation) + "/")
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "No se pudo abrir el registro.");
        if (active) { if (body.completed) setDone(true); else setDefaults(body); }
      }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [invitation]);
  function attach(kind: string, file: Blob | null) { setFiles(current => ({ ...current, [kind]: file })); }
  const kind = minor ? "minor" : identity;
  const documentKinds = minor ? ["minor_credential", "curp", "guardian_ine_front", "guardian_ine_back"]
    : identity === "ine" ? ["ine_front", "ine_back"] : ["identity_document"];
  const required = ["player_photo", "player_signature", ...documentKinds, ...(minor ? ["guardian_signature"] : [])];
  function navigate(next: number) { setError(""); setStep(next); if (content.current) content.current.scrollTop = 0; }
  function next() {
    setError("");
    if (step === 0) { if (accepted) navigate(1); return; }
    if (!birthDate || birthDate > maxDate || Number(birthDate.slice(0, 4)) < today.getFullYear() - 110) {
      setError("Revisa la fecha de nacimiento."); return;
    }
    if (documentKinds.some(item => !files[item])) { setError("Adjunta los documentos de identificación."); return; }
    if (documentKinds.some(item => (files[item]?.size || 0) > ENROLLMENT_FILE_MAX_BYTES)) { setError("Cada foto o documento puede pesar hasta 20 MB."); return; }
    navigate(2);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== 2 || !accepted || saving.current) return;
    setError("");
    const formElement = event.currentTarget;
    if (!birthDate || birthDate > maxDate || Number(birthDate.slice(0, 4)) < today.getFullYear() - 110) {
      setStep(1); setError("Revisa la fecha de nacimiento."); return;
    }
    if (!formElement.checkValidity()) {
      const invalid = formElement.querySelector<HTMLInputElement>("input:invalid");
      setError(`Revisa ${invalid?.closest("label")?.textContent?.trim().toLocaleLowerCase() || "los campos obligatorios"}.`);
      invalid?.scrollIntoView({ block: "center" }); invalid?.focus(); return;
    }
    const missing = required.filter(item => !files[item]);
    if (missing.length) { setError("Falta: " + missing.map(item => item === "player_photo" ? "selfie del jugador" : labels[item] || item).join(", ") + "."); return; }
    if (["player_photo", ...documentKinds].some(item => (files[item]?.size || 0) > ENROLLMENT_FILE_MAX_BYTES)) {
      setError("Cada foto o documento puede pesar hasta 20 MB."); return;
    }
    saving.current = true; setBusy(true);
    try {
      const form = new FormData(formElement);
      form.set("birth_date", birthDate); form.set("identity_type", kind); form.set("accepted_terms", "true");
      required.forEach(item => form.append(item, files[item]!,
        item.includes("signature") ? item + ".png" : (files[item] as File).name));
      const response = await fetch(API_URL + "/player-enrollments/public/" + encodeURIComponent(invitation) + "/",
        { method: "POST", body: form, signal: AbortSignal.timeout(180000) });
      const body = await response.json().catch(() => { throw new Error("El servidor no respondió correctamente. Intenta de nuevo."); });
      if (!response.ok) throw new Error(body.detail || Object.values(body).flat().join(" ") || "No se pudo guardar. Intenta de nuevo.");
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <main className="enrollment-page public-enrollment-wizard">
    {done ? <section className="registration-sheet"><h1>Inscripción recibida</h1><p>Tus datos, documentos y firmas quedaron guardados.</p></section> :
      <form className="registration-sheet enrollment-wizard-sheet" onSubmit={submit} noValidate>
        <header className="enrollment-wizard-header"><span>Paso {step + 1} de 3</span><h1>{["Aviso y aceptación", "Fecha e identificación", "Selfie y datos del jugador"][step]}</h1></header>
        <div ref={content} className="enrollment-wizard-content">
          {!defaults ? <p>{error ? "Solicita otro enlace si este ya no está disponible." : "Cargando…"}</p> : <>
            <section hidden={step !== 0}>
              <Terms items={defaults.terms} />
              <label className={`consent enrollment-consent-card${accepted ? " is-accepted" : ""}`}><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
                He leído y acepto los compromisos generales. Autorizo el resguardo privado de los datos, identificación, foto y firmas para gestionar mi inscripción.
              </label>
            </section>
            <section hidden={step !== 1}>
              <div className="enrollment-wizard-identity-fields">
              <label>Fecha de nacimiento<input name="birth_date" type="date" required value={birthDate} max={maxDate} onChange={event => setBirthDate(event.target.value)} /></label>
              {!minor && <label>Identificación<select value={identity} onChange={event => setIdentity(event.target.value)}>
                <option value="ine">INE</option><option value="passport">Pasaporte</option><option value="military_card">Cartilla</option>
              </select></label>}
              </div>
              <div className="enrollment-wizard-uploads">{documentKinds.map(item =>
                <Upload key={item + kind} label={item === "identity_document" ? (identity === "passport" ? "Pasaporte" : "Cartilla") : labels[item]}
                  onChange={file => attach(item, file)} />)}</div>
            </section>
            <section hidden={step !== 2}>
              <div className="enrollment-wizard-player">
                <Upload label="Selfie del jugador" photo onChange={file => attach("player_photo", file)} />
                <div className="player-fields">
                  <label className="full">Nombre<input name="name" required maxLength={160} autoComplete="name" disabled={step !== 2} /></label>
                  <label>Equipo<input readOnly value={defaults.team} /></label>
                  <label>Torneo<input readOnly value={defaults.tournament} /></label>
                  <label>Fecha de nacimiento<input readOnly value={birthDate ? birthDate.split("-").reverse().join("/") : ""} /></label>
                  <label>Teléfono de contacto<input name="phone" required type="tel" maxLength={30} disabled={step !== 2} /></label>
                  <label>Teléfono de emergencia (opcional)<input name="phone_secondary" type="tel" maxLength={30} disabled={step !== 2} /></label>
                  {minor && <label className="full">Nombre del padre o tutor<input name="guardian_name" required maxLength={160} disabled={step !== 2} /></label>}
                </div>
              </div>
              <div className="enrollment-wizard-signatures"><Signature label="Firma del jugador" onChange={blob => attach("player_signature", blob)} />
                {minor && <Signature label="Firma del tutor" onChange={blob => attach("guardian_signature", blob)} />}</div>
              {minor && <p>El padre o tutor autoriza la participación del menor y acepta los compromisos anteriores.</p>}
            </section>
          </>}
        </div>
        <div className="enrollment-wizard-footer">
        {error && <p className="error" role="alert">{error}</p>}
        {defaults && <footer className="enrollment-wizard-actions">
          {step > 0 && <button type="button" disabled={busy} onClick={() => navigate(step - 1)}>Atrás</button>}
          {step < 2 ? <button type="button" className="primary" disabled={step === 0 && !accepted} onClick={next}>{step === 0 ? "Aceptar y continuar" : "Siguiente"}</button>
            : <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Confirmar inscripción"}</button>}
        </footer>}
        </div>
      </form>}
  </main>;
}

function PrivateImage({ document, token, alt }: { document?: Document; token: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!document) return;
    let active = true, objectUrl = "";
    const controller = new AbortController();
    fetch(API_URL + "/player-enrollments/documents/" + document.id + "/", {
      headers: { Authorization: "Token " + token }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) return;
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document?.id, token]);
  return url ? <img src={url} alt={alt} /> : <span className="photo-placeholder">{document ? "Cargando imagen…" : "Sin foto"}</span>;
}

function TeamRosterPage({ team, tournament, token, onBack }: { team: Team; tournament?: Tournament; token: string; onBack: () => void }) {
  const [players, setPlayers] = useState<Enrollment[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [date, setDate] = useState(""), [round, setRound] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function loadRoster() {
      try {
        const all: Enrollment[] = [];
        let page = 1, count = 0;
        do {
          const params = new URLSearchParams({ team_id: String(team.id), tournament_id: String(team.tournament), page: String(page) });
          const result = await apiRequest<{ results: Enrollment[]; count: number }>("/player-enrollments/?" + params, token, { signal: controller.signal });
          count = result.count;
          if (!result.results.length && all.length < count) throw new Error("No se pudo cargar la plantilla completa.");
          all.push(...result.results); page += 1;
        } while (all.length < count);
        if (!controller.signal.aborted) setPlayers(Array.from(new Map(all.map(row => [row.id, row])).values()));
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar la plantilla."); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void loadRoster(); return () => controller.abort();
  }, [team.id, team.tournament, token]);
  return <section className="enrollment-team-roster-view">
    <div className="operator-controls no-print"><button type="button" onClick={onBack}>Volver a equipos</button>
      <div className="control-grid"><label>Fecha<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Jornada<input value={round} maxLength={30} onChange={event => setRound(event.target.value)} /></label><button type="button" disabled={busy || Boolean(error) || !players.length} onClick={() => window.print()}>Imprimir / guardar PDF</button></div>
    </div>
    {busy && <p role="status">Cargando plantilla…</p>}{error && <p className="error" role="alert">{error}</p>}
    {!busy && !error && <div className="enrollment-team-roster-scroll"><section className="roster-sheet">
      <div className="roster-header"><div><p><strong>Equipo:</strong> {team.name}</p><p><strong>Torneo:</strong> {tournament?.name || players[0]?.tournament || ""}</p></div><div><p><strong>Fecha:</strong> {date ? date.split("-").reverse().join("/") : ""}</p><p><strong>Jornada:</strong> {round}</p></div></div>
      <div className="roster-grid">{players.map(row => <article className="enrollment-roster-card" key={row.id}><PrivateImage document={row.documents.find(doc => doc.kind === "player_photo")} token={token} alt={row.name} /><div><strong>{row.name}</strong><span>{row.birth_date.split("-").reverse().join("/")}</span></div></article>)}</div>
      {!players.length && <p className="enrollment-roster-empty">Este equipo aún no tiene jugadores inscritos.</p>}
      <footer><p>La presente cédula ampara a los jugadores que cumplen con los requisitos para participar en partidos de temporada y liguilla.</p><p>Solo podrán ingresar a la cancha los jugadores y delegados del presente documento.</p><p>Equipo que ingrese jugador no registrado perderá automáticamente su partido.</p></footer>
    </section></div>}
  </section>;
}

export function EnrollmentDashboard({ token, onLogout, restricted = false }: {
  token: string; onLogout: () => void; restricted?: boolean;
}) {
  const [rows, setRows] = useState<Enrollment[]>([]), [page, setPage] = useState(1), [count, setCount] = useState(0);
  const [search, setSearch] = useState(""), [team, setTeam] = useState(""), [tournament, setTournament] = useState("");
  const [date, setDate] = useState(""), [round, setRound] = useState("");
  const [link, setLink] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<Enrollment | null>(null);
  const [catalog, setCatalog] = useState<EnrollmentCatalog>({ sites: [], tournaments: [], teams: [] });
  const [catalogBusy, setCatalogBusy] = useState(true), [catalogError, setCatalogError] = useState("");
  const [inviteTournament, setInviteTournament] = useState(""), [inviteTeam, setInviteTeam] = useState("");
  const [tournamentSection, setTournamentSection] = useState<TournamentSection | null>(null);
  const [enrollmentSection, setEnrollmentSection] = useState<"send" | "history">("history");
  const [rosterTeam, setRosterTeam] = useState<Team | null>(null);
  const [rosterRevision, setRosterRevision] = useState(0);
  const invitationSaving = useRef(false);
  const selectedTournament = catalog.tournaments.find(item => String(item.id) === inviteTournament);
  const availableTeams = catalog.teams.filter(item => String(item.tournament) === inviteTournament);
  // The shared workspace only uses catalog fields in setupOnly mode. It never
  // loads students, finance, matches or representative contact details here.
  const tournamentData: AppData = { ...emptyData, sites: catalog.sites as Site[],
    tournaments: catalog.tournaments, teams: catalog.teams as Team[] };
  const unsupportedAction = async () => { throw new Error("Acción no disponible en Inscripciones."); };
  async function deleteTournament(id: number, confirmation: StudentDeletionConfirmation) {
    const result = await apiRequest<StudentDeletionResult>(`/player-enrollments/tournaments/${id}/`, token, {
      method: "DELETE", body: JSON.stringify(confirmation),
    });
    chooseTournament("");
    await loadCatalog().catch(() => undefined);
    return result;
  }
  async function deleteTeam(id: number, confirmation: StudentDeletionConfirmation) {
    const result = await apiRequest<StudentDeletionResult>(`/player-enrollments/teams/${id}/`, token, {method: "DELETE", body: JSON.stringify(confirmation)});
    setCatalog(previous => ({...previous, teams: previous.teams.filter(team => team.id !== id)}));
    if (inviteTeam === String(id)) {setInviteTeam(""); setLink("");}
    await loadCatalog().catch(() => undefined);
    return result;
  }
  async function loadCatalog() {
    setCatalogBusy(true); setCatalogError("");
    try {
      const result = await apiRequest<EnrollmentCatalog>("/player-enrollments/catalog/", token);
      setCatalog(result); return result;
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "No pudimos cargar los torneos y equipos.");
      throw err;
    } finally { setCatalogBusy(false); }
  }
  function chooseTournament(value: string) {
    setInviteTournament(value); setInviteTeam(""); setLink("");
  }
  async function saveCatalog(kind: "team" | "tournament", payload: unknown) {
    const created = await apiRequest<Team | Tournament>("/player-enrollments/catalog/", token, {
      method: "POST", body: JSON.stringify({ ...(payload as Record<string, unknown>), kind }),
    });
    setCatalog(previous => kind === "team"
      ? { ...previous, teams: [...previous.teams, created as Team] }
      : { ...previous, tournaments: [...previous.tournaments, created as Tournament] });
    // Creation succeeded: a failed refresh must not invite a duplicate POST.
    await loadCatalog().catch(() => undefined);
    return created;
  }
  async function load(next = page) {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(next), search, team_id: team, tournament_id: tournament });
      const result = await apiRequest<{ results: Enrollment[]; count: number }>("/player-enrollments/?" + params, token);
      setRows(result.results); setCount(result.count); setPage(next);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar el historial."); }
    finally { setBusy(false); }
  }
  useEffect(() => { document.title = "Inscripciones BPower"; void load(1); void loadCatalog().catch(() => undefined); }, [token]);
  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invitationSaving.current) return;
    if (!selectedTournament || !availableTeams.some(item => String(item.id) === inviteTeam)) {
      setError("Selecciona un torneo y uno de sus equipos."); return;
    }
    invitationSaving.current = true; setBusy(true); setError(""); setMessage(""); setLink("");
    try {
      const data = { tournament_id: Number(inviteTournament), team_id: Number(inviteTeam) };
      const result = await apiRequest<{ token: string }>("/player-enrollments/", token, { method: "POST", body: JSON.stringify(data) });
      setLink(window.location.origin + window.location.pathname + "#/inscripcion/" + result.token);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo crear el enlace."); }
    finally { invitationSaving.current = false; setBusy(false); }
  }
  async function download(doc: Document, enrollment: number) {
    try {
      const response = await fetch(API_URL + "/player-enrollments/documents/" + doc.id + "/", { headers: { Authorization: "Token " + token } });
      if (!response.ok) throw new Error("No se pudo descargar el documento.");
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "registro-" + enrollment + "-" + doc.kind +
        (blob.type === "application/pdf" ? ".pdf" : blob.type === "image/png" ? ".png" : ".jpg");
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo descargar."); }
  }
  const groups = new Map<string, Enrollment[]>();
  rows.forEach(row => { const key = row.team_id ? `team:${row.team_id}` : row.team + "\u0000" + row.tournament; groups.set(key, [...(groups.get(key) || []), row]); });
  return <main className={`enrollment-page enrollment-admin-layout${tournamentSection === "overview" || tournamentSection === "teams" || tournamentSection === "team-create" ? " enrollment-directory-layout" : ""}${tournamentSection === "teams" || tournamentSection === "team-create" ? " enrollment-teams-layout" : ""}${rosterTeam ? " enrollment-roster-layout" : ""}`}>
    <aside className="enrollment-admin-sidebar no-print">
      <h2>Inscripciones BPower</h2><p>Administración de inscripciones</p>
      <nav aria-label="Administración de inscripciones" onClickCapture={() => setRosterTeam(null)}>
        <div className="enrollment-sidebar-heading"><ClipboardList size={18} aria-hidden="true" />Inscripciones</div>
        <div className="enrollment-sidebar-submenu">
          <button aria-current={tournamentSection === null && enrollmentSection === "send" ? "page" : undefined} onClick={() => { setTournamentSection(null); setEnrollmentSection("send"); setSelected(null); setError(""); setMessage(""); }}><Send size={16} aria-hidden="true" />Enviar enlace</button>
          <button aria-current={tournamentSection === null && enrollmentSection === "history" ? "page" : undefined} onClick={() => { setTournamentSection(null); setEnrollmentSection("history"); setError(""); setMessage(""); }}><ClipboardList size={16} aria-hidden="true" />Inscripciones</button>
        </div>
        <div className="enrollment-sidebar-heading"><Trophy size={18} />Torneos</div>
        <div className="enrollment-sidebar-submenu">
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "overview" ? "page" : undefined} onClick={() => setTournamentSection("overview")}><ListChecks size={16} aria-hidden="true" />Torneos activos</button>
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "create" ? "page" : undefined} onClick={() => setTournamentSection("create")}><CirclePlus size={16} aria-hidden="true" />Crear torneo</button>
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "teams" ? "page" : undefined} onClick={() => setTournamentSection("teams")}><UsersRound size={16} />Equipos</button>
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "team-create" ? "page" : undefined} onClick={() => setTournamentSection("team-create")}><UserPlus size={16} aria-hidden="true" />Crear equipo</button>
        </div>
      </nav>
    </aside>
    <div className="operator-page">
      <header className="operator-header enrollment-admin-header no-print"><h1>{rosterTeam ? "Plantilla" : tournamentSection === "create" ? "Crear torneo" : tournamentSection === "team-create" ? "Crear equipo" : tournamentSection === "teams" ? "Equipos" : tournamentSection === "overview" ? "Torneos" : enrollmentSection === "send" ? "Enviar enlace" : "Inscripciones"}</h1><div>
        <button aria-label="Actualizar" title="Actualizar" disabled={busy || catalogBusy} onClick={() => { if (rosterTeam) setRosterRevision(value => value + 1); void load(page); void loadCatalog().catch(() => undefined); }}><RefreshCw size={19} /><span>Actualizar</span></button>
        <button aria-label="Cerrar sesión" title="Cerrar sesión" onClick={onLogout}><LogOut size={19} /><span>Cerrar sesión</span></button>
      </div></header>
      {error && <p className="error no-print" role="alert">{error}</p>}
      {message && <p className="no-print" role="status">{message}</p>}
      {catalogError && <p className="error no-print" role="alert">{catalogError} <button onClick={() => void loadCatalog().catch(() => undefined)}>Volver a cargar equipos y torneos</button></p>}
      {rosterTeam ? <TeamRosterPage key={`${rosterTeam.id}:${rosterRevision}`} team={rosterTeam} tournament={catalog.tournaments.find(row => row.id === rosterTeam.tournament)} token={token} onBack={() => setRosterTeam(null)} /> : tournamentSection !== null ? <section className={`operator-controls enrollment-tournament-workspace no-print${tournamentSection === "create" ? " enrollment-tournament-create" : ""}`}>
        <TournamentsPanel token={token} data={tournamentData} scope="adult" setupOnly
          deletableTournamentIds={catalog.deletable_tournament_ids || []}
          deletionCollectionPath="player-enrollments/tournaments"
          section={tournamentSection} onSelectSection={setTournamentSection}
          selectedTournamentId={inviteTournament ? Number(inviteTournament) : undefined}
          onSelectTournament={id => chooseTournament(String(id))}
          onCreateTournament={payload => saveCatalog("tournament", payload)}
          onCreateTeam={async payload => {
            const created = await saveCatalog("team", payload) as Team;
            setInviteTournament(String(created.tournament)); setInviteTeam(String(created.id)); setLink("");
            return created;
          }}
          onDeleteTeam={deleteTeam} onDeleteTournament={deleteTournament} onRegisterStudent={unsupportedAction}
          onViewTeamRoster={setRosterTeam}
          onUpdateRegistration={unsupportedAction} onCreateMatch={unsupportedAction} onUpdateMatch={unsupportedAction} />
      </section> : enrollmentSection === "send" ?
      <section className="operator-controls no-print">
        <h2>Enviar enlace</h2>
        <form onSubmit={invite} className="control-grid">
          <label>Torneo para la inscripción<select required value={inviteTournament} disabled={catalogBusy || busy}
            onChange={event => chooseTournament(event.target.value)}><option value="">Selecciona un torneo</option>
            {catalog.tournaments.map(item => <option key={item.id} value={item.id}>{item.name} · {catalog.sites.find(site => site.id === item.site)?.name}</option>)}</select></label>
          <label>Equipo del torneo<select required value={inviteTeam} disabled={catalogBusy || busy || !inviteTournament}
            onChange={event => { setInviteTeam(event.target.value); setLink(""); }}><option value="">Selecciona un equipo</option>
            {availableTeams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button disabled={busy || catalogBusy || !inviteTeam} className="primary">Crear enlace</button>
        </form>
        {!catalogBusy && !catalog.tournaments.length && <p>Primero crea un torneo en la subsección «Crear torneo» del menú izquierdo.</p>}
        {!catalogBusy && inviteTournament && !availableTeams.length && <p>Este torneo todavía no tiene equipos.</p>}
        {link && <div className="share-link"><input readOnly value={link} aria-label="Enlace de inscripción" /><div>
          <button onClick={() => { void navigator.clipboard.writeText(link).then(() => setMessage("Enlace copiado."), () => setError("Copia el enlace manualmente.")); }}>Copiar enlace</button>
          <a href={"https://wa.me/?text=" + encodeURIComponent("Hola, completa y firma tu inscripción aquí: " + link)} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
          <a href={link} target="_blank" rel="noreferrer">Ver formulario</a>
        </div></div>}
      </section> : <>
      <section className="operator-controls no-print">
        <h2>Historial · {count} inscritos</h2>
        <form onSubmit={event => { event.preventDefault(); void load(1); }} className="control-grid">
          <label>Nombre<input value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>Torneo del historial<select value={tournament} onChange={event => { setTournament(event.target.value); setTeam(""); }}><option value="">Todos</option>
            {catalog.tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Equipo del historial<select value={team} onChange={event => setTeam(event.target.value)}><option value="">Todos</option>
            {catalog.teams.filter(item => !tournament || String(item.tournament) === tournament).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button disabled={busy}>Buscar / actualizar</button>
        </form>
        <div className="control-grid">
          <label>Fecha de la cédula<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label>Jornada<input value={round} onChange={event => setRound(event.target.value)} maxLength={30} /></label>
          <button type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button>
        </div>
      </section>
      {selected ? <section className="registration-sheet signed-sheet">
        <button className="no-print" onClick={() => setSelected(null)}>Volver a cédula</button>
        <div className="sheet-top">
          <section className="documentation-frame"><h2>Documentación presentada</h2>
            {selected.documents.filter(doc => !["player_photo", "player_signature", "guardian_signature"].includes(doc.kind)).map(doc =>
              <div key={doc.id}><p>{labels[doc.kind] || doc.kind}</p><PrivateImage document={doc} token={token} alt={labels[doc.kind]} />
                <button className="no-print" onClick={() => void download(doc, selected.id)}>Descargar documento</button></div>)}
          </section>
          <section className="player-frame">
            <div className="photo-and-signatures">
              <PrivateImage document={selected.documents.find(doc => doc.kind === "player_photo")} token={token} alt={selected.name} />
              <div>{["player_signature", ...(selected.guardian_name ? ["guardian_signature"] : [])].map(kind =>
                <div key={kind}><p>{labels[kind]}</p><PrivateImage document={selected.documents.find(doc => doc.kind === kind)} token={token} alt={labels[kind]} /></div>)}</div>
            </div>
            <div className="player-fields"><p className="full">NOMBRE<br /><strong>{selected.name}</strong></p>
              <p>EQUIPO<br />{selected.team}</p><p>TORNEO<br />{selected.tournament}</p>
              <p>TELÉFONO DE CONTACTO<br />{selected.phone}</p><p>TELÉFONO DE EMERGENCIA<br />{selected.phone_secondary}</p>
              <p>NACIMIENTO<br />{selected.birth_date}</p><p>FIRMADO<br />{new Date(selected.signed_at).toLocaleString("es-MX")}</p>
            </div>
          </section>
        </div>
        <Terms items={selected.terms_text || []} guardian={selected.guardian_name} player={selected.name} />
      </section> : <>
        {busy && <p className="no-print">Cargando…</p>}
        {!busy && !rows.length && <p>Todavía no hay inscripciones firmadas para esta búsqueda.</p>}
        {Array.from(groups.entries()).map(([key, group]) => <section className="roster-sheet" key={key}>
          <div className="roster-header">
            <div><p><strong>Equipo:</strong> {group[0].team}</p><p><strong>Torneo:</strong> {group[0].tournament || "Sin torneo"}</p></div>
            <div><p><strong>Fecha:</strong> {date}</p><p><strong>Jornada:</strong> {round}</p></div>
          </div>
          <div className="roster-grid">{group.map(row => <button className="roster-player" key={row.id} onClick={() => setSelected(row)}>
            <PrivateImage document={row.documents.find(doc => doc.kind === "player_photo")} token={token} alt={row.name} />
            <div><strong>{row.name}</strong><span>{row.birth_date.split("-").reverse().join("/")}</span></div>
          </button>)}</div>
          <footer>
            <p>La presente cédula ampara a los jugadores que cumplen con los requisitos para participar en partidos de temporada y liguilla.</p>
            <p>Solo podrán ingresar a la cancha los jugadores y delegados del presente documento.</p>
            <p>Equipo que ingrese jugador no registrado perderá automáticamente su partido.</p>
          </footer>
        </section>)}
        <div className="pagination no-print"><button disabled={busy || page <= 1} onClick={() => void load(page - 1)}>Anterior</button>
          <span>Página {page} · {rows.length} jugadores en esta página</span>
          <button disabled={busy || page * 25 >= count} onClick={() => void load(page + 1)}>Siguiente</button>
        </div>
      </>}
      </>}
    </div>
  </main>;
}
