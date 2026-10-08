import { useEffect, useRef, useState } from "react";
import { API_URL, apiRequest } from "../../api";
import "./enrollments.css";
import type { User, Team, Tournament, Site } from "../../types";
import { TournamentCreatePage } from "../tournaments/TournamentCreatePage";
import { CreateTeamDialog } from "../tournaments/TournamentManagementDialogs";
import "../tournaments/tournaments.css";

const labels: Record<string, string> = {
  player_photo: "Foto del jugador", ine_front: "INE frente", ine_back: "INE reverso",
  identity_document: "Pasaporte / cartilla", minor_credential: "Credencial del menor", curp: "CURP",
  guardian_ine_front: "INE del tutor frente", guardian_ine_back: "INE del tutor reverso",
  player_signature: "Firma del jugador", guardian_signature: "Firma del tutor",
};
type Document = { id: number; kind: string };
type Enrollment = {
  id: number; name: string; birth_date: string; team: string; tournament: string; team_id: number | null; tournament_id: number | null;
  phone: string; phone_secondary: string; guardian_name: string; signed_at: string;
  terms_text: string[]; documents: Document[];
};
type Defaults = { team: string; tournament: string; terms: string[] };
type EnrollmentCatalog = { sites: Pick<Site, "id" | "name">[]; tournaments: Tournament[]; teams: Pick<Team, "id" | "name" | "tournament" | "is_active">[] };

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
  const upload = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
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
      <button type="button" onClick={() => camera.current?.click()}>Tomar foto</button>
    </div>
    <input ref={upload} type="file" hidden accept={photo ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"}
      onChange={event => select(event.target.files?.[0] || null)} />
    <input ref={camera} type="file" hidden accept="image/jpeg,image/png" capture={photo ? "user" : "environment"}
      onChange={event => select(event.target.files?.[0] || null)} />
    <small>{name || (photo ? "Foto obligatoria" : "JPG, PNG o PDF · máximo 3 MB")}</small>
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
  const [birthDate, setBirthDate] = useState(""), minor = under18(birthDate);
  const [identity, setIdentity] = useState("ine");
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [files, setFiles] = useState<Record<string, Blob | null>>({});
  const [error, setError] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = "Hoja de registro";
    fetch(API_URL + "/player-enrollments/public/" + encodeURIComponent(invitation) + "/")
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "No se pudo abrir el registro.");
        if (body.completed) setDone(true); else setDefaults(body);
      }).catch(err => setError(err.message));
  }, [invitation]);
  function attach(kind: string, file: Blob | null) { setFiles(current => ({ ...current, [kind]: file })); }
  const kind = minor ? "minor" : identity;
  const required = ["player_photo", "player_signature",
    ...(minor ? ["minor_credential", "curp", "guardian_ine_front", "guardian_ine_back", "guardian_signature"]
      : identity === "ine" ? ["ine_front", "ine_back"] : ["identity_document"])];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (required.some(item => !files[item])) { setError("Completa la foto, los documentos y las firmas obligatorias."); return; }
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      form.set("identity_type", kind);
      required.forEach(item => form.append(item, files[item]!,
        item.includes("signature") ? item + ".png" : (files[item] as File).name));
      const response = await fetch(API_URL + "/player-enrollments/public/" + encodeURIComponent(invitation) + "/",
        { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || Object.values(body).flat().join(" ") || "No se pudo guardar. Intenta de nuevo.");
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return <main className="enrollment-page">
    {done ? <section className="registration-sheet"><h1>Inscripción recibida</h1><p>Tus datos, documentos y firmas quedaron guardados. No necesitas enviarlos de nuevo.</p></section> :
      <form className="registration-sheet" onSubmit={submit}>
        <h1>Hoja de registro</h1>
        <p className="help">Completa todos los campos. Puedes adjuntar documentos o tomar fotos desde tu celular.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {!defaults ? <p>{error ? "Solicita otro enlace si este ya no está disponible." : "Cargando…"}</p> : <>
          <div className="sheet-top">
            <section className="documentation-frame">
              <h2>Foto de documentación</h2>
              <label>Fecha de nacimiento<input name="birth_date" type="date" required value={birthDate}
                max={new Date().toLocaleDateString("en-CA")}
                onChange={event => setBirthDate(event.target.value)}
                onInput={event => setBirthDate(event.currentTarget.value)}
                onBlur={event => setBirthDate(event.currentTarget.value)} /></label>
              {!minor && <label>Identificación<select value={identity} onChange={event => setIdentity(event.target.value)}>
                <option value="ine">INE</option><option value="passport">Pasaporte</option>
                <option value="military_card">Cartilla</option>
              </select></label>}
              {minor ? <>
                <p>En caso de ser menor: credencial, CURP e INE del tutor.</p>
                {["minor_credential", "curp", "guardian_ine_front", "guardian_ine_back"].map(item =>
                  <Upload key={item} label={labels[item]} onChange={file => attach(item, file)} />)}
              </> : (identity === "ine" ? ["ine_front", "ine_back"] : ["identity_document"]).map(item =>
                <Upload key={item + identity} label={item === "identity_document" ? (identity === "passport" ? "Pasaporte" : "Cartilla") : labels[item]}
                  onChange={file => attach(item, file)} />)}
            </section>
            <section className="player-frame">
              <div className="photo-and-signatures">
                <Upload label="Foto de jugador" photo onChange={file => attach("player_photo", file)} />
                <div>
                  <Signature label="Firma de jugador" onChange={blob => attach("player_signature", blob)} />
                  {minor ? <Signature label="Firma del tutor (obligatoria)" onChange={blob => attach("guardian_signature", blob)} /> :
                    <div className="adult-signature-note">Firma del tutor: no aplica para mayores de edad.</div>}
                </div>
              </div>
              <div className="player-fields">
                <label className="full">Nombre<input name="name" required maxLength={160} autoComplete="name" /></label>
                <label>Equipo<input readOnly value={defaults.team} /></label>
                <label>Torneo<input readOnly value={defaults.tournament} /></label>
                <label>Teléfono de contacto<input name="phone" required type="tel" maxLength={30} /></label>
                <label>Teléfono de emergencia<input name="phone_secondary" required type="tel" maxLength={30} /></label>
                <label>Folio de pago (opcional)<input name="payment_reference" maxLength={80} /></label>
                {minor && <label className="full">Nombre del padre o tutor<input name="guardian_name" required maxLength={160} /></label>}
              </div>
            </section>
          </div>
          <Terms items={defaults.terms} />
          {minor && <p>El padre o tutor autoriza la participación del menor y acepta los compromisos anteriores.</p>}
          <label className="consent"><input type="checkbox" name="accepted_terms" value="true" required />
            He leído y acepto los compromisos generales. Autorizo el resguardo privado de los datos, identificación, foto y firmas para gestionar mi inscripción.
          </label>
          <button className="primary" disabled={busy}>{busy ? "Guardando…" : "Firmar y enviar inscripción"}</button>
        </>}
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
  const [createTournament, setCreateTournament] = useState(false), [createTeam, setCreateTeam] = useState(false);
  const invitationSaving = useRef(false);
  const selectedTournament = catalog.tournaments.find(item => String(item.id) === inviteTournament);
  const availableTeams = catalog.teams.filter(item => String(item.tournament) === inviteTournament);
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
  return <main className="enrollment-page">
    <div className="operator-page">
      <header className="operator-header no-print"><h1>Inscripciones BPower</h1><div>
        {!restricted && <a href="#">Volver a administración</a>}<button onClick={onLogout}>Salir</button>
      </div></header>
      {error && <p className="error no-print" role="alert">{error}</p>}
      {message && <p className="no-print" role="status">{message}</p>}
      {catalogError && <p className="error no-print" role="alert">{catalogError} <button onClick={() => void loadCatalog().catch(() => undefined)}>Volver a cargar equipos y torneos</button></p>}
      <nav className="operator-controls no-print" aria-label="Administración de inscripciones">
        <button onClick={() => { setCreateTournament(false); setCreateTeam(false); }}>Inscripciones</button>
        <button disabled={catalogBusy || busy} onClick={() => { setCreateTournament(true); setCreateTeam(false); }}>Crear torneo</button>
        <button disabled={catalogBusy || busy} onClick={() => { setCreateTournament(false); setCreateTeam(true); }}>Crear equipo</button>
        <button disabled={catalogBusy || busy} onClick={() => void loadCatalog().catch(() => undefined)}>Actualizar equipos y torneos</button>
      </nav>
      {createTournament ? <section className="operator-controls no-print">
        <TournamentCreatePage sites={catalog.sites} onBack={() => setCreateTournament(false)}
          onCreate={payload => saveCatalog("tournament", payload)} onCreated={created => {
            chooseTournament(String(created.id)); setCreateTournament(false); setMessage("Torneo creado. Ahora selecciona o crea su equipo.");
          }} />
      </section> : <>
      <section className="operator-controls no-print">
        <h2>Enviar una nueva inscripción</h2><p>Crea un enlace por jugador. Tiene vigencia de 30 días.</p>
        <p>Elige un torneo existente y uno de sus equipos. El jugador recibirá el formulario con esa asignación fija.</p>
        <form onSubmit={invite} className="control-grid">
          <label>Torneo para la inscripción<select required value={inviteTournament} disabled={catalogBusy || busy}
            onChange={event => chooseTournament(event.target.value)}><option value="">Selecciona un torneo</option>
            {catalog.tournaments.map(item => <option key={item.id} value={item.id}>{item.name} · {catalog.sites.find(site => site.id === item.site)?.name}</option>)}</select></label>
          <label>Equipo del torneo<select required value={inviteTeam} disabled={catalogBusy || busy || !inviteTournament}
            onChange={event => { setInviteTeam(event.target.value); setLink(""); }}><option value="">Selecciona un equipo</option>
            {availableTeams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button disabled={busy || catalogBusy || !inviteTeam} className="primary">Crear enlace</button>
        </form>
        {!catalogBusy && !catalog.tournaments.length && <p>Primero crea un torneo con el botón «Crear torneo».</p>}
        {!catalogBusy && inviteTournament && !availableTeams.length && <p>Este torneo todavía no tiene equipos. Usa «Crear equipo».</p>}
        {createTeam && !selectedTournament && <p role="status">Selecciona arriba el torneo al que pertenecerá el nuevo equipo.</p>}
        {createTeam && selectedTournament && <CreateTeamDialog tournament={selectedTournament} adult onClose={() => setCreateTeam(false)}
          onSave={async payload => {
            const created = await saveCatalog("team", payload) as Team;
            setInviteTeam(String(created.id)); setLink(""); setCreateTeam(false); setMessage("Equipo creado en el torneo seleccionado.");
          }} />}
        {link && <div className="share-link"><input readOnly value={link} aria-label="Enlace de inscripción" /><div>
          <button onClick={() => { void navigator.clipboard.writeText(link).then(() => setMessage("Enlace copiado."), () => setError("Copia el enlace manualmente.")); }}>Copiar enlace</button>
          <a href={"https://wa.me/?text=" + encodeURIComponent("Hola, completa y firma tu inscripción aquí: " + link)} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
          <a href={link} target="_blank" rel="noreferrer">Ver formulario</a>
        </div></div>}
      </section>
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
