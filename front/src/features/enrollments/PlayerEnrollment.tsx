import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw, LogOut, Trophy, UsersRound, ClipboardList, Send, ListChecks, CirclePlus, UserPlus, Eye, Printer, Menu, X } from "lucide-react";
import { API_URL, apiRequest } from "../../api";
import "./enrollments.css";
import "./enrollmentAdmin.css";
import "./rosterIdentity.css";
import rosterWatermark from "./assets/bpower-roster-watermark.png";
import "./enrollmentButtons.css";
import "./enrollmentSelects.css";
import "./enrollmentValidation.css";
import "./localEnrollment.css";
import { birthDateError, documentErrors, playerFieldErrors, type EnrollmentErrors } from './enrollmentValidation';
import { PrintableDelegate } from "./PrintableDelegate";
import { EnrollmentBrand } from "./EnrollmentBrand";
import { WhatsAppIcon } from "./WhatsAppIcon";
import { EnrollmentDatePicker } from "./EnrollmentDatePicker";
import { EnrollmentNavigation, useEnrollmentNavigation, useEnrollmentViewState, useEnrollmentScrollReady } from './EnrollmentNavigation';
import type { EnrollmentSection } from './enrollmentHistory';
import { SanctionBadge, type SanctionSummary } from "./SanctionBadge";
import { WithdrawalPlayerCard, type WithdrawalPlayer } from "./WithdrawalPlayerCard";
import { WithdrawalHistory } from "./WithdrawalHistory";
import { NewSanction } from "./NewSanction";
import { DisciplinaryRecords } from "./DisciplinaryRecords";
import { PlayersDirectory } from "./PlayersDirectory";
import type { AppData, User, Team, Tournament, Site, StudentDeletionConfirmation, StudentDeletionResult } from "../../types";
import { emptyData } from "../../appState";
import { TournamentsPanel, type TournamentSection } from "../tournaments";
import { CameraCapture } from "./CameraCapture";
import { compressEnrollmentPhoto } from "./compressEnrollmentPhoto";
import { ChangeDelegate } from "./ChangeDelegate";
import { sampleLighting, type LightingResult } from './photoLighting';
import { LightingIndicator } from './LightingIndicator';

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
  terms_text: string[]; documents: Document[]; is_delegate?: boolean; sanctions?: SanctionSummary[];
};
type Defaults = { team: string; tournament: string; terms: string[]; is_delegate?: boolean; delegate_name?: string; delegate_phone?: string };
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
    <h1 className="enrollment-login-brand"><EnrollmentBrand /></h1>{error && <p role="alert" className="error">{error}</p>}
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
  const hasInk = useRef(false);
  const previous = useRef<[number, number] | null>(null);
  function point(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - bounds.left) * 900 / bounds.width, (event.clientY - bounds.top) * 360 / bounds.height];
  }
  return <section className="signature-box">
    <p>{label}</p>
    <canvas ref={canvas} width={900} height={360} aria-label={label}
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
          hasInk.current = true;
        }
        previous.current = next;
      }}
      onPointerUp={() => { drawing.current = false; if (hasInk.current) canvas.current?.toBlob(onChange, "image/png"); }}
      onPointerCancel={() => { drawing.current = false; if (hasInk.current) canvas.current?.toBlob(onChange, "image/png"); }}
    />
    <button type="button" className="quiet" onClick={() => {
      hasInk.current = false; canvas.current?.getContext("2d")?.clearRect(0, 0, 900, 360); onChange(null);
    }}>Borrar firma</button>
  </section>;
}

function Upload({ label, photo = false, onChange, onProcessing }: {
  label: string; photo?: boolean; onChange: (file: File | null) => void; onProcessing?: (busy: boolean) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [name, setName] = useState(""), [preview, setPreview] = useState("");
  const [lighting, setLighting] = useState<LightingResult | null>(null);
  const [lightingUnavailable, setLightingUnavailable] = useState(false);
  const previewRef = useRef("");
  const selection = useRef(0);
  const [processing, setProcessing] = useState(false), [uploadError, setUploadError] = useState("");
  useEffect(() => () => { selection.current++; if (previewRef.current) URL.revokeObjectURL(previewRef.current); onProcessing?.(false); }, []);
  async function select(file: File | null) {
    const version = ++selection.current;
    setLighting(null); setLightingUnavailable(false);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = ""; setPreview(""); setName(""); setUploadError(""); onChange(null);
    setProcessing(true); onProcessing?.(true);
    try {
      const prepared = file ? await compressEnrollmentPhoto(file) : null;
      if (version !== selection.current) return;
      const url = prepared?.type.startsWith("image/") ? URL.createObjectURL(prepared) : "";
      previewRef.current = url; setPreview(url);
      setName(prepared ? `${prepared.name} · ${(prepared.size / 1_000_000).toFixed(2)} MB${prepared !== file ? " · comprimida" : ""}` : ""); onChange(prepared);
    } catch (reason) { if (version === selection.current) setUploadError(reason instanceof Error ? reason.message : "No se pudo procesar la foto."); }
    finally { if (version === selection.current) { setProcessing(false); onProcessing?.(false); } }
  }
  return <section className={"upload-box " + (photo ? "player-photo" : "")}>
    <p>{label}</p>
    {photo && <small>Sin lentes, gorras u objetos que tapen la cara.</small>}
    {preview && <img key={preview} src={preview} alt={label + " adjunta"} onLoad={event => {
      if (previewRef.current !== preview) return;
      try {
        const source = event.currentTarget;
        setLighting(sampleLighting(source, source.naturalWidth, source.naturalHeight, document.createElement('canvas')));
      } catch { setLightingUnavailable(true); }
    }} onError={() => { if (previewRef.current === preview) setLightingUnavailable(true); }} />}
    {preview && <LightingIndicator result={lighting} checking={!lighting && !lightingUnavailable} unavailable={lightingUnavailable} />}
    <div className="upload-actions">
      <button type="button" onClick={() => upload.current?.click()}>Adjuntar</button>
      <button type="button" onClick={() => setCameraOpen(true)}>Tomar foto</button>
    </div>
    <input ref={upload} type="file" hidden accept={photo ? "image/jpeg,image/png" : "image/jpeg,image/png,application/pdf"}
      onChange={event => select(event.target.files?.[0] || null)} />
    {cameraOpen && <CameraCapture selfie={photo} onClose={() => setCameraOpen(false)}
      onCapture={file => { select(file); setCameraOpen(false); }} />}
    {processing && <small role="status">Comprimiendo foto…</small>}
    {uploadError && <p className="error" role="alert">{uploadError}</p>}
    <small>{name || (photo ? "JPG o PNG · compresión automática a máximo 3 MB" : "Fotos: compresión automática a máximo 3 MB · PDF: máximo 20 MB")}</small>
  </section>;
}

function EnrollmentField({ name, error, children, full = false }: { name: string; error?: string; children: ReactNode; full?: boolean }) {
  return <div data-enrollment-field={name} tabIndex={-1} role="group" aria-describedby={error ? `enrollment-error-${name}` : undefined} className={`enrollment-validation-field${error ? ' enrollment-invalid' : ''}${full ? ' full' : ''}`}>
    {children}{error && <p id={`enrollment-error-${name}`} className="enrollment-field-error">{error}</p>}
  </div>;
}

function Terms({ items, guardian, player }: { items: string[]; guardian?: string; player?: string }) {
  return <section className="commitments">
    <h2>Compromisos Generales</h2>
    {items.map((text, index) => <p key={index}>{text}</p>)}
    {guardian && <p>Yo {guardian}, como tutor de {player || "el menor"}, autorizo la participación del menor,
      deslindando de toda responsabilidad a la liga, al club, al colegio y a su personal.</p>}
  </section>;
}

export function PublicPlayerEnrollment({ invitation, embedded = false, onCompleted, onBusyChange }: {
  invitation: string; embedded?: boolean; onCompleted?: (completed: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [step, setStep] = useState(0), [accepted, setAccepted] = useState(false);
  const [birthDate, setBirthDate] = useState(""), minor = under18(birthDate);
  const [identity, setIdentity] = useState("ine");
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [files, setFiles] = useState<Record<string, Blob | null>>({});
  const [processingFiles, setProcessingFiles] = useState<Record<string, boolean>>({});
  const processingPhoto = Object.values(processingFiles).some(Boolean);
  function processing(kind: string, value: boolean) { setProcessingFiles(current => ({ ...current, [kind]: value })); }
  const [error, setError] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => { onCompleted?.(done); }, [done, onCompleted]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const content = useRef<HTMLDivElement>(null);
  const [fieldErrors, setFieldErrors] = useState<EnrollmentErrors>({});
  const [focusIssue, setFocusIssue] = useState(0);
  useEffect(() => {
    if (!focusIssue) return;
    const first = content.current?.querySelector<HTMLElement>('section:not([hidden]) .enrollment-invalid');
    first?.scrollIntoView({ block: 'center', behavior: 'auto' });
    (first?.querySelector<HTMLElement>('input:not([hidden]):not([type=hidden]), button, canvas') || first)?.focus({ preventScroll: true });
  }, [focusIssue, step]);
  function showIssues(issues: EnrollmentErrors, targetStep = step) {
    setFieldErrors(issues); setStep(targetStep);
    setError('Completa o corrige los campos marcados en rojo.'); setFocusIssue(value => value + 1);
  }
  function clearIssue(name: string) { setFieldErrors(current => { const next = { ...current }; delete next[name]; return next; }); }
  function accessibility(name: string) { return { 'aria-invalid': !!fieldErrors[name], 'aria-describedby': fieldErrors[name] ? `enrollment-error-${name}` : undefined }; }
  const today = new Date();
  const maxDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  useEffect(() => {
    if (!embedded) document.title = "Inscripción BPower";
    let active = true;
    fetch(API_URL + "/player-enrollments/public/" + encodeURIComponent(invitation) + "/")
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || "No se pudo abrir el registro.");
        if (active) { if (body.completed) setDone(true); else setDefaults(body); }
      }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [invitation, embedded]);
  function attach(kind: string, file: Blob | null) {
    setFiles(current => ({ ...current, [kind]: file }));
    if (file && file.size <= ENROLLMENT_FILE_MAX_BYTES) clearIssue(kind);
  }
  const kind = minor ? "minor" : identity;
  const documentKinds = minor ? ["minor_credential", "curp", "guardian_ine_front", "guardian_ine_back"]
    : identity === "ine" ? ["ine_front", "ine_back"] : ["identity_document"];
  const required = ["player_photo", "player_signature", ...documentKinds, ...(minor ? ["guardian_signature"] : [])];
  function navigate(next: number) { setError(""); setFieldErrors({}); setStep(next); if (content.current) content.current.scrollTop = 0; }
  function identityErrors() {
    const issues = documentErrors(documentKinds, files, labels);
    const dateError = birthDateError(birthDate, maxDate);
    return dateError ? { birth_date: dateError, ...issues } : issues;
  }
  function next() {
    setError("");
    if (processingPhoto) { setError("Espera a que termine de comprimirse la foto."); return; }
    if (step === 0) { if (accepted) navigate(1); else showIssues({ accepted_terms: 'Acepta los compromisos y el aviso de privacidad para continuar.' }); return; }
    const issues = identityErrors();
    if (Object.keys(issues).length) { showIssues(issues); return; }
    navigate(2);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    if (step !== 2) { next(); return; }
    if (!accepted) { showIssues({ accepted_terms: 'Acepta los compromisos para continuar.' }, 0); return; }
    if (processingPhoto) { setError("Espera a que termine de comprimirse la foto."); return; }
    setError("");
    const formElement = event.currentTarget;
    const identityIssues = identityErrors();
    if (Object.keys(identityIssues).length) { showIssues(identityIssues, 1); return; }
    const nameForm = new FormData(formElement);
    const issues = { ...documentErrors(['player_photo'], files, labels), ...playerFieldErrors(Object.fromEntries([...nameForm].map(([key, value]) => [key, String(value)])), minor) };
    for (const signature of ['player_signature', ...(minor ? ['guardian_signature'] : [])]) {
      if (!files[signature]) issues[signature] = `Falta ${labels[signature].toLocaleLowerCase()}.`;
    }
    if (Object.keys(issues).length) { showIssues(issues); return; }
    setFieldErrors({});
    saving.current = true; setBusy(true);
    try {
      const form = new FormData(formElement);
      form.set("birth_date", birthDate); form.set("identity_type", kind); form.set("accepted_terms", "true");
      required.forEach(item => form.append(item, files[item]!,
        item.includes("signature") ? item + ".png" : (files[item] as File).name));
      const response = await fetch(API_URL + "/player-enrollments/public/" + encodeURIComponent(invitation) + "/",
        { method: "POST", body: form, signal: AbortSignal.timeout(180000) });
      const body = await response.json().catch(() => { throw new Error("El servidor no respondió correctamente. Intenta de nuevo."); });
      if (!response.ok) {
        const fieldNames = ['birth_date', ...required, 'given_names', 'paternal_surname', 'maternal_surname', 'phone', 'phone_secondary', 'guardian_name', 'accepted_terms'];
        const issues: EnrollmentErrors = {};
        if (body && typeof body === 'object') for (const name of fieldNames) {
          if (body[name]) issues[name] = Array.isArray(body[name]) ? body[name].join(' ') : String(body[name]);
        }
        if (body?.name) for (const name of ['given_names', 'paternal_surname', 'maternal_surname']) issues[name] = Array.isArray(body.name) ? body.name.join(' ') : String(body.name);
        if (Object.keys(issues).length) {
          showIssues(issues, issues.accepted_terms ? 0 : issues.birth_date || documentKinds.some(name => issues[name]) ? 1 : 2); return;
        }
        throw new Error(body.detail || Object.values(body).flat().join(" ") || "No se pudo guardar. Intenta de nuevo.");
      }
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { saving.current = false; setBusy(false); }
  }
  const consent = <EnrollmentField name="accepted_terms" error={fieldErrors.accepted_terms}><label className={`consent enrollment-consent-card${accepted ? " is-accepted" : ""}`}><input type="checkbox" {...accessibility('accepted_terms')} checked={accepted} onChange={event => { setAccepted(event.target.checked); if (event.target.checked) clearIssue('accepted_terms'); }} />
    He leído y acepto los compromisos generales. Autorizo el resguardo privado de los datos, identificación, foto y firmas para gestionar mi inscripción.
  </label></EnrollmentField>;
  return <main className={`enrollment-page public-enrollment-wizard${embedded ? ' enrollment-wizard-embedded' : ''}`}>
    <div className="enrollment-public-brand no-print"><EnrollmentBrand /></div>
    {done ? <section className="registration-sheet"><h1>Inscripción recibida</h1><p>Tus datos, documentos y firmas quedaron guardados.</p></section> :
      <form className="registration-sheet enrollment-wizard-sheet" onSubmit={submit} noValidate onChange={event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || !fieldErrors[input.name]) return;
        const values = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value)]));
        const updated = playerFieldErrors(values, minor);
        setFieldErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !['given_names', 'paternal_surname', 'maternal_surname', 'phone', 'guardian_name'].includes(key) || !!updated[key]).map(([key, message]) => [key, updated[key] || message])));
      }}>
        <header className="enrollment-wizard-header"><span>Paso {step + 1} de 3</span><h1>{["Aviso y aceptación", "Fecha e identificación", "Selfie y datos del jugador"][step]}</h1></header>
        <div ref={content} className="enrollment-wizard-content">
          {!defaults ? <p>{error ? "Solicita otro enlace si este ya no está disponible." : "Cargando…"}</p> : <>
            <section hidden={step !== 0}>
              <EnrollmentField name="accepted_terms_top" error={fieldErrors.accepted_terms}><label className={`consent enrollment-consent-card${accepted ? ' is-accepted' : ''}`}><input type="checkbox" aria-invalid={!!fieldErrors.accepted_terms} aria-describedby={fieldErrors.accepted_terms ? 'enrollment-error-accepted_terms_top' : undefined} checked={accepted} onChange={event => { setAccepted(event.target.checked); if (event.target.checked) clearIssue('accepted_terms'); }} />
                He leído y acepto los compromisos generales. Autorizo el resguardo privado de los datos, identificación, foto y firmas para gestionar mi inscripción.
              </label></EnrollmentField>
              <Terms items={defaults.terms} />
              {consent}
            </section>
            <section hidden={step !== 1}>
              <div className="enrollment-wizard-identity-fields">
              <EnrollmentField name="birth_date" error={fieldErrors.birth_date}><EnrollmentDatePicker label="Fecha de nacimiento" name="birth_date" required birthday forceNative={embedded} value={birthDate} max={maxDate} invalid={!!fieldErrors.birth_date} describedBy={fieldErrors.birth_date ? 'enrollment-error-birth_date' : undefined} onChange={value => { setBirthDate(value); if (!birthDateError(value, maxDate)) clearIssue('birth_date'); }} /></EnrollmentField>
              {!minor && <label>Identificación<select value={identity} onChange={event => setIdentity(event.target.value)}>
                <option value="ine">INE</option><option value="passport">Pasaporte</option><option value="military_card">Cartilla</option>
              </select></label>}
              </div>
              <div className="enrollment-wizard-uploads">{documentKinds.map(item =>
                <EnrollmentField key={item + kind} name={item} error={fieldErrors[item]}><Upload label={item === "identity_document" ? (identity === "passport" ? "Pasaporte" : "Cartilla") : labels[item]}
                  onChange={file => attach(item, file)} onProcessing={value => processing(item, value)} /></EnrollmentField>)}</div>
            </section>
            <section hidden={step !== 2}>
              <div className="enrollment-wizard-player">
                <EnrollmentField name="player_photo" error={fieldErrors.player_photo}><Upload label="Selfie del jugador" photo onChange={file => attach("player_photo", file)} onProcessing={value => processing("player_photo", value)} /></EnrollmentField>
                <div className="player-fields">
                  <EnrollmentField name="given_names" full error={fieldErrors.given_names}><label>Nombre(s)<input {...accessibility('given_names')} name="given_names" required maxLength={80} autoComplete="given-name" disabled={step !== 2} /></label></EnrollmentField>
                  <EnrollmentField name="paternal_surname" error={fieldErrors.paternal_surname}><label>Apellido paterno<input {...accessibility('paternal_surname')} name="paternal_surname" required maxLength={80} autoComplete="family-name" disabled={step !== 2} /></label></EnrollmentField>
                  <EnrollmentField name="maternal_surname" error={fieldErrors.maternal_surname}><label>Apellido materno<input {...accessibility('maternal_surname')} name="maternal_surname" required maxLength={80} disabled={step !== 2} /></label></EnrollmentField>
                  {defaults.delegate_name && <p className="full">Primero debe inscribirse el delegado: {defaults.delegate_name}. Escribe sus nombres y apellidos completos en los campos anteriores.</p>}
                  <label>Equipo<input readOnly value={defaults.team} /></label>
                  <label>Torneo<input readOnly value={defaults.tournament} /></label>
                  <label>Fecha de nacimiento<input readOnly value={birthDate ? birthDate.split("-").reverse().join("/") : ""} /></label>
                  <EnrollmentField name="phone" error={fieldErrors.phone}><label>Teléfono de contacto<input {...accessibility('phone')} name="phone" required type="tel" maxLength={30} defaultValue={defaults.delegate_phone || ""} disabled={step !== 2} /></label></EnrollmentField>
                  <EnrollmentField name="phone_secondary" error={fieldErrors.phone_secondary}><label>Teléfono de emergencia (opcional)<input {...accessibility('phone_secondary')} name="phone_secondary" type="tel" maxLength={30} disabled={step !== 2} /></label></EnrollmentField>
                  {minor && <EnrollmentField name="guardian_name" full error={fieldErrors.guardian_name}><label>Nombre del padre o tutor<input {...accessibility('guardian_name')} name="guardian_name" required maxLength={160} disabled={step !== 2} /></label></EnrollmentField>}
                </div>
              </div>
              <div className="enrollment-wizard-signatures"><EnrollmentField name="player_signature" error={fieldErrors.player_signature}><Signature label="Firma del jugador" onChange={blob => attach("player_signature", blob)} /></EnrollmentField>
                {minor && <EnrollmentField name="guardian_signature" error={fieldErrors.guardian_signature}><Signature label="Firma del tutor" onChange={blob => attach("guardian_signature", blob)} /></EnrollmentField>}</div>
              {minor && <p>El padre o tutor autoriza la participación del menor y acepta los compromisos anteriores.</p>}
            </section>
          </>}
        </div>
        <div className="enrollment-wizard-footer">
        {error && <p className="error" role="alert">{error}</p>}
        {defaults && <footer className="enrollment-wizard-actions">
          {step > 0 && <button type="button" disabled={busy} onClick={() => navigate(step - 1)}>Atrás</button>}
          {step < 2 ? <button type="button" className="primary" disabled={processingPhoto} onClick={next}>{processingPhoto ? "Procesando foto…" : step === 0 ? "Aceptar y continuar" : "Siguiente"}</button>
            : <button className="primary" disabled={busy || processingPhoto}>{processingPhoto ? "Procesando foto…" : busy ? "Guardando…" : "Confirmar inscripción"}</button>}
        </footer>}
        </div>
      </form>}
  </main>;
}

function PrivateImage({ document, token, alt, onReady }: { document?: Document; token: string; alt: string; onReady?: (ok: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    if (!document) return;
    let active = true, objectUrl = "";
    const controller = new AbortController();
    fetch(API_URL + "/player-enrollments/documents/" + document.id + "/", {
      headers: { Authorization: "Token " + token }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) throw new Error("Imagen no disponible");
      objectUrl = URL.createObjectURL(await response.blob());
      if (active) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) { setFailed(true); ready.current?.(false); } });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document?.id, token]);
  return url ? <img src={url} alt={alt} onLoad={() => ready.current?.(true)} onError={() => ready.current?.(false)} /> : <span className="photo-placeholder">{failed ? "Imagen no disponible" : document ? "Cargando imagen…" : "Sin foto"}</span>;
}

export function PublicPlayerWithdrawal({ invitation }: { invitation: string }) {
  const [details, setDetails] = useState<{team: string; tournament: string; players: WithdrawalPlayer[]} | null>(null);
  const [selected, setSelected] = useState<number[]>([]), [accepted, setAccepted] = useState(false);
  const selectedPlayers = details?.players.filter(player => selected.includes(player.id)) || [];
  function togglePlayer(id: number) {
    if (details?.players.find(player => player.id === id)?.can_withdraw === false) return;
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id].sort((a, b) => a - b));
    setAccepted(false); setSignature(null);
  }
  const [signature, setSignature] = useState<Blob | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const saving = useRef(false);
  const endpoint = API_URL + "/player-enrollments/withdrawal/" + encodeURIComponent(invitation) + "/";
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, {signal: controller.signal}).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "No se pudo abrir el enlace de baja.");
      setDetails(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [endpoint]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (saving.current) return;
    if (!selected.length || !accepted || !signature) { setError("Selecciona uno o más integrantes, confirma las bajas y firma."); return; }
    saving.current = true; setBusy(true); setError("");
    try {
      const data = new FormData(); selected.forEach(id => data.append("enrollment_ids", String(id))); data.append("accepted", "true"); data.append("withdrawal_signature", signature, "firma-baja.png");
      const response = await fetch(endpoint, {method: "POST", body: data}); const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "No se pudo guardar la baja."); setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la baja."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <main className="enrollment-page"><section className="registration-sheet">
    <div className="enrollment-public-brand"><EnrollmentBrand /></div>
    <h1>Dar de baja</h1>{done ? <p role="status">{selected.length} baja(s) firmada(s) y registrada(s). Se conservan las fichas de los jugadores.</p> : <>
      {details && <form onSubmit={submit}><p>{details.team} · {details.tournament}</p><fieldset disabled={busy}>
        <legend>Selecciona uno o más integrantes</legend><p>Los jugadores con sanciones pendientes no pueden darse de baja hasta cumplir su período.</p>
        <div className="withdrawal-player-list">{details.players.map(player => <WithdrawalPlayerCard key={player.id} player={player} endpoint={endpoint} selected={selected.includes(player.id)} onChange={() => togglePlayer(player.id)} />)}</div>
        {!details.players.length && <p>No hay integrantes activos para dar de baja.</p>}
        {!!selected.length && <><p>{selected.length} integrante(s) seleccionado(s):</p><ul>{selectedPlayers.map(player => <li key={player.id}>{player.name}</li>)}</ul><label className="consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />Confirmo la baja de todos los integrantes seleccionados de este equipo. Mi firma aplica a todas estas bajas.</label><Signature key={selected.join(",")} label="Firma de las bajas seleccionadas" onChange={setSignature} /></>}
        <button className="primary" disabled={!selected.length || !accepted || !signature || busy}>{busy ? "Guardando bajas…" : `Firmar y confirmar ${selected.length || ""} baja(s)`}</button>
      </fieldset></form>}{!details && !error && <p role="status">Cargando integrantes…</p>}{error && <p className="error" role="alert">{error}</p>}
    </>}</section></main>;
}

export function TeamRosterPage({ team, tournament, token, onBack, autoPrint = false, alignment = false }: { team: Team; tournament?: Tournament; token: string; onBack: () => void; autoPrint?: boolean; alignment?: boolean }) {
  const [players, setPlayers] = useState<Enrollment[]>([]);
  const [changingDelegate, setChangingDelegate] = useState(false);
  const [delegateMessage, setDelegateMessage] = useState("");
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [date, setDate] = useEnrollmentViewState(`paper.${team.id}.date`, ""), [round, setRound] = useEnrollmentViewState(`paper.${team.id}.round`, "");
  const [time, setTime] = useEnrollmentViewState(`paper.${team.id}.time`, "");
  useEnrollmentScrollReady(!busy);
  const [imageResults, setImageResults] = useState<Record<number, boolean>>({});
  const [watermarkReady, setWatermarkReady] = useState(false);
  const [watermarkFailed, setWatermarkFailed] = useState(false);
  const printed = useRef(false);
  const photos = alignment ? [] : players.flatMap(row => row.documents.filter(doc => doc.kind === "player_photo" || doc.kind === "player_signature"));
  const photosReady = photos.every(doc => imageResults[doc.id] === true) && (alignment || watermarkReady);
  const photoFailed = Object.values(imageResults).includes(false);
  useEffect(() => {
    if (!autoPrint || printed.current || busy || error || !photosReady) return;
    const frame = requestAnimationFrame(() => { printed.current = true; window.print(); });
    return () => cancelAnimationFrame(frame);
  }, [autoPrint, busy, error, photosReady]);
  useEffect(() => {
    const controller = new AbortController();
    async function loadRoster() {
      try {
        const all: Enrollment[] = [];
        let page = 1, count = 0;
        do {
          const params = new URLSearchParams({ team_id: String(team.id), tournament_id: String(team.tournament), page: String(page), active_only: "true" });
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
  const slots = tournament?.max_players_per_team || 16;
  const pages = Array.from({ length: Math.max(1, Math.ceil(players.length / slots)) }, (_, page) => players.slice(page * slots, (page + 1) * slots));
  const formattedDate = date ? date.split("-").reverse().join("/") : "";
  return <section className="enrollment-team-roster-view">
    <div className="operator-controls no-print"><div className="enrollment-delegate-toolbar"><div className="enrollment-delegate-actions"><button type="button" onClick={onBack}>Volver</button>
      {!alignment && <button type="button" disabled={busy || Boolean(error) || !players.some(row => !row.is_delegate)} onClick={() => { setDelegateMessage(""); setChangingDelegate(true); }}>Cambiar delegado</button>}</div>
      {!alignment && <p>Delegado: <strong>{players.find(row => row.is_delegate)?.name || "Sin delegado"}</strong></p>}</div>
      <div className="control-grid"><label>Fecha<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Horario<input type="time" value={time} onChange={event => setTime(event.target.value)} /></label>{!alignment && <label>Jornada<input value={round} maxLength={30} onChange={event => setRound(event.target.value)} /></label>}<button type="button" disabled={busy || Boolean(error) || !photosReady} onClick={() => window.print()}>Imprimir / guardar PDF</button></div>
    </div>
    {busy && <p role="status">Cargando plantilla…</p>}{error && <p className="error" role="alert">{error}</p>}
    {delegateMessage && <p className="no-print" role="status">{delegateMessage}</p>}
    {changingDelegate && <ChangeDelegate teamId={team.id} teamName={team.name} players={players} token={token} onClose={() => setChangingDelegate(false)} onChanged={id => {
      setPlayers(previous => previous.map(row => ({ ...row, is_delegate: row.id === id })).sort((a, b) => Number(Boolean(b.is_delegate)) - Number(Boolean(a.is_delegate))));
      setChangingDelegate(false); setDelegateMessage("Delegado actualizado.");
    }} />}
    {(photoFailed || watermarkFailed) && <p className="error no-print" role="alert">No se pudieron cargar todas las fotos, firmas o la marca de agua. Actualiza antes de imprimir.</p>}
    {!busy && !error && <div className="enrollment-team-roster-scroll">{pages.map((pagePlayers, page) => <section key={page} className={`roster-sheet match-paper ${alignment ? "alignment-paper" : "photo-paper"}`}>
      {!alignment && <img className="roster-watermark" src={rosterWatermark} alt="" aria-hidden="true" onLoad={() => setWatermarkReady(true)} onError={() => { setWatermarkReady(false); setWatermarkFailed(true); }} />}
      <h1 className="alignment-title">{alignment ? "HOJA DE ALINEACIÓN" : "SÁBANA DE JUGADORES"}</h1>
      <div className="match-paper-header"><div><strong>{team.name}</strong><small>EQUIPO</small><b>{tournament?.name || players[0]?.tournament || ""}</b><small>CATEGORÍA</small></div><div><strong>{formattedDate || "\u00a0"}</strong><small>FECHA</small><b>{time || "\u00a0"}</b><small>HORARIO</small></div></div>
      {!alignment && <p className="match-round">{round || "\u00a0"}</p>}
      <PrintableDelegate name={players.find(row => row.is_delegate)?.name} />
      <div className="match-paper-columns">{[0, 1].map(column => <div key={column} className="match-paper-column">{Array.from({ length: slots / 2 }, (_, index) => {
        const row = pagePlayers[column * (slots / 2) + index];
        const imageReady = (kind: string, ok: boolean) => {
          const id = row?.documents.find(doc => doc.kind === kind)?.id;
          if (id) setImageResults(previous => previous[id] === ok ? previous : { ...previous, [id]: ok });
        };
        return <article className={`match-player-box${row?.sanctions?.length ? " is-sanctioned" : ""}`} key={index}>{alignment ? <><div className="alignment-number"><span>Número</span></div><div className="alignment-fields"><div><small>Nombre</small><strong>{row?.name || "\u00a0"}</strong></div><div>{row?.sanctions?.length ? <SanctionBadge sanctions={row.sanctions} /> : <small>Firma</small>}</div></div></> : <>
          <div className="alignment-number roster-dorsal"><span>Dorsal</span></div>
          <div className="match-photo">{row && <PrivateImage document={row.documents.find(doc => doc.kind === "player_photo")} token={token} alt={`Foto de ${row.name}`} onReady={ok => imageReady("player_photo", ok)} />}</div>
          <div className="roster-identity-fields"><div className="roster-name"><small>Nombre</small><strong>{row?.name || "\u00a0"}</strong><SanctionBadge sanctions={row?.sanctions} /></div>
            <div className="roster-player-signature">{row?.documents.some(doc => doc.kind === "player_signature") ? <PrivateImage document={row.documents.find(doc => doc.kind === "player_signature")} token={token} alt={`Firma de ${row.name}`} onReady={ok => imageReady("player_signature", ok)} /> : row ? <span className="roster-signature-missing">Firma no disponible</span> : null}<small>Firma</small></div>
          </div>
        </>}</article>;
      })}</div>)}</div>
      {alignment && <footer className="alignment-signatures"><div><span>FIRMA DEL CAPITÁN</span></div><div><span>FIRMA DEL ÁRBITRO</span></div><div className="alignment-count"><span>Nº DE JUGADORES</span></div></footer>}
    </section>)}</div>}
  </section>;
}

export function EnrollmentDashboard(props: { token: string; onLogout: () => void; restricted?: boolean; userId?: number }) {
  return <EnrollmentNavigation key={props.userId || 0} userId={props.userId || 0}><EnrollmentDashboardContent {...props} /></EnrollmentNavigation>;
}
function EnrollmentDashboardContent({ token, onLogout, restricted = false }: {
  token: string; onLogout: () => void; restricted?: boolean; userId?: number;
}) {
  const navigation = useEnrollmentNavigation()!;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => { setMobileViewport(media.matches); if (!media.matches) setMobileMenuOpen(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileMenuOpen) { if (menuWasOpen.current) menuButtonRef.current?.focus(); menuWasOpen.current = false; return; }
    menuWasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobileMenuOpen(false); }
      if (event.key !== "Tab") return;
      const items = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)") || []);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); };
  }, [mobileMenuOpen]);
  const [search, setSearch] = useEnrollmentViewState('roster.search', ""), [team, setTeam] = useEnrollmentViewState('roster.team', ""), [tournament, setTournament] = useEnrollmentViewState('roster.tournament', "");
  const [link, setLink] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<EnrollmentCatalog>({ sites: [], tournaments: [], teams: [] });
  const [catalogBusy, setCatalogBusy] = useState(true), [catalogError, setCatalogError] = useState("");
  const [inviteTournament, setInviteTournament] = useEnrollmentViewState('invite.tournament', ""), [inviteTeam, setInviteTeam] = useEnrollmentViewState('invite.team', "");
  const tournamentSection = navigation.screen.section.startsWith('tournament-') ? navigation.screen.section.slice('tournament-'.length) as TournamentSection : null;
  const enrollmentSection = tournamentSection || navigation.screen.section === 'tools' ? 'history' : navigation.screen.section;
  function setTournamentSection(section: TournamentSection | null) {
    if (section) navigation.navigate({ section: `tournament-${section}` as EnrollmentSection, roster: null, detail: null, alignment: false });
  }
  function setEnrollmentSection(section: EnrollmentSection) {
    navigation.navigate({ section, roster: null, detail: null, alignment: false });
  }
  const rosterTeam = catalog.teams.find(row => row.id === navigation.screen.roster) as Team | undefined;
  const [printRoster, setPrintRoster] = useState(false);
  // Old alignment links now open the unified roster, without a second tool.
  const alignmentSheet = false;
  useEnrollmentScrollReady(!catalogBusy);
  useEffect(() => { setMobileMenuOpen(false); if (!navigation.screen.roster) setPrintRoster(false); setError(''); setMessage(''); }, [navigation.screen.section, navigation.screen.roster]);
  const [rosterRevision, setRosterRevision] = useState(0);
  const invitationSaving = useRef(false);
  const [localRegistration, setLocalRegistration] = useState<{ token: string; team: string; tournament: string } | null>(null);
  const [localCompleted, setLocalCompleted] = useState(false), [localSaving, setLocalSaving] = useState(false);
  const localDialogRef = useRef<HTMLDialogElement>(null), localButtonRef = useRef<HTMLButtonElement>(null);
  const restoreLocalFocus = useRef(false);
  useEffect(() => {
    if (restoreLocalFocus.current && !localRegistration && !catalogBusy) {
      localButtonRef.current?.focus(); restoreLocalFocus.current = false;
    }
  }, [localRegistration, catalogBusy]);
  useEffect(() => {
    if (!localRegistration) return;
    const dialog = localDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; localButtonRef.current?.focus(); };
  }, [localRegistration]);
  function closeLocalRegistration() {
    if (localSaving) return;
    if (!localCompleted && !window.confirm('¿Cerrar el registro local? Los datos que no hayas enviado se perderán.')) return;
    restoreLocalFocus.current = true; setLocalRegistration(null);
    if (localCompleted) { setRosterRevision(value => value + 1); void loadCatalog().catch(() => undefined); }
  }
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
  useEffect(() => { document.title = "Inscripciones BPower"; void loadCatalog().catch(() => undefined); }, [token]);
  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createInvitation();
  }
  async function createInvitation(local = false) {
    if (invitationSaving.current) return;
    if (!selectedTournament || !availableTeams.some(item => String(item.id) === inviteTeam)) {
      setError("Selecciona un torneo y uno de sus equipos."); return;
    }
    invitationSaving.current = true; setBusy(true); setError(""); setMessage(""); setLink("");
    try {
      const data = { tournament_id: Number(inviteTournament), team_id: Number(inviteTeam), purpose: !local && enrollmentSection === "withdraw" ? "withdraw" : "enroll" };
      const result = await apiRequest<{ token: string }>("/player-enrollments/", token, { method: "POST", body: JSON.stringify(data) });
      if (local) {
        setLocalCompleted(false); setLocalSaving(false);
        setLocalRegistration({ token: result.token, team: availableTeams.find(item => String(item.id) === inviteTeam)!.name, tournament: selectedTournament.name });
      } else setLink(window.location.origin + window.location.pathname + (enrollmentSection === "withdraw" ? "#/baja/" : "#/inscripcion/") + result.token);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo crear el enlace."); }
    finally { invitationSaving.current = false; setBusy(false); }
  }
  const filteredTeams = catalog.teams.filter(item => (!tournament || String(item.tournament) === tournament)
    && (!team || String(item.id) === team) && item.name.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")));
  function openRoster(item: typeof catalog.teams[number], print = false, alignment = false) {
    navigation.navigate({ roster: item.id, alignment, detail: null });
    setPrintRoster(print);
  }
  return <main className={`enrollment-page enrollment-admin-layout${tournamentSection === "overview" || tournamentSection === "teams" || tournamentSection === "team-create" || (tournamentSection === null && enrollmentSection === "history") ? " enrollment-directory-layout" : ""}${tournamentSection === "teams" || tournamentSection === "team-create" ? " enrollment-teams-layout" : ""}${rosterTeam ? " enrollment-roster-layout" : ""}`}>
    {mobileMenuOpen && <button type="button" className="enrollment-menu-backdrop no-print" aria-label="Cerrar menú de inscripciones" onClick={() => setMobileMenuOpen(false)} />}
    <aside ref={sidebarRef} id="enrollment-sections-menu" className={`enrollment-admin-sidebar no-print${mobileMenuOpen ? " is-open" : ""}`} role={mobileViewport && mobileMenuOpen ? "dialog" : undefined} aria-modal={mobileViewport && mobileMenuOpen ? true : undefined} aria-label="Secciones de inscripciones" aria-hidden={mobileViewport && !mobileMenuOpen ? true : undefined}>
      <button type="button" className="enrollment-menu-close" aria-label="Cerrar secciones" onClick={() => setMobileMenuOpen(false)}><X size={20} /></button>
      <h2 className="enrollment-sidebar-brand"><EnrollmentBrand /></h2><p>Administración de inscripciones</p>
      <nav aria-label="Administración de inscripciones" onClickCapture={() => { setPrintRoster(false); setMobileMenuOpen(false); }}>
        <div className="enrollment-sidebar-heading"><ClipboardList size={18} aria-hidden="true" />Inscripciones</div>
        <div className="enrollment-sidebar-submenu">
          <button aria-current={tournamentSection === null && enrollmentSection === "send" ? "page" : undefined} onClick={() => { setTournamentSection(null); setEnrollmentSection("send"); setLink(""); setError(""); setMessage(""); }}><Send size={16} aria-hidden="true" />Registrar</button>
          <button aria-current={tournamentSection === null && enrollmentSection === "history" ? "page" : undefined} onClick={() => { setTournamentSection(null); setEnrollmentSection("history"); setError(""); setMessage(""); }}><ClipboardList size={16} aria-hidden="true" />Sábana</button>
        </div>
        <div className="enrollment-sidebar-heading"><LogOut size={18} aria-hidden="true" />Bajas</div>
        <div className="enrollment-sidebar-submenu">
          <button aria-current={tournamentSection === null && enrollmentSection === "withdraw" ? "page" : undefined} onClick={() => { setTournamentSection(null); setEnrollmentSection("withdraw"); setLink(""); setError(""); setMessage(""); }}><UserPlus size={16} aria-hidden="true" />Nueva baja</button>
          <button aria-current={tournamentSection === null && enrollmentSection === "withdraw-history" ? "page" : undefined} onClick={() => { setTournamentSection(null); setEnrollmentSection("withdraw-history"); setError(""); setMessage(""); }}><ListChecks size={16} aria-hidden="true" />Histórico de bajas</button>
        </div>
        <div className="enrollment-sidebar-heading"><ClipboardList size={18} />Sanciones</div>
        <div className="enrollment-sidebar-submenu">{([['commission','Comisión disciplinaria'],['sanction-new','Nueva sanción'],['blacklist','Lista negra']] as const).map(([section,label])=><button key={section} aria-current={tournamentSection===null&&enrollmentSection===section?'page':undefined} onClick={()=>{setTournamentSection(null);setEnrollmentSection(section);setError('');setMessage('')}}>{label}</button>)}</div>
        <div className="enrollment-sidebar-heading"><Trophy size={18} />Torneos</div>
        <div className="enrollment-sidebar-submenu">
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "overview" ? "page" : undefined} onClick={() => setTournamentSection("overview")}><ListChecks size={16} aria-hidden="true" />Torneos activos</button>
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "create" ? "page" : undefined} onClick={() => setTournamentSection("create")}><CirclePlus size={16} aria-hidden="true" />Crear torneo</button>
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "teams" ? "page" : undefined} onClick={() => setTournamentSection("teams")}><UsersRound size={16} />Equipos</button>
          <button aria-current={enrollmentSection === "players" ? "page" : undefined} onClick={() => setEnrollmentSection("players")}><UsersRound size={16} aria-hidden="true" />Jugadores</button>
          <button disabled={catalogBusy || busy} aria-current={tournamentSection === "team-create" ? "page" : undefined} onClick={() => setTournamentSection("team-create")}><UserPlus size={16} aria-hidden="true" />Crear equipo</button>
        </div>
      </nav>
    </aside>
    <div className="operator-page">
      <header className="operator-header enrollment-admin-header no-print"><button ref={menuButtonRef} type="button" className="enrollment-menu-open" aria-label="Abrir secciones" aria-expanded={mobileMenuOpen} aria-controls="enrollment-sections-menu" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button><h1>{rosterTeam ? (alignmentSheet ? "Hoja de alineación · " : "Sábana · ") + rosterTeam.name : tournamentSection === "create" ? "Crear torneo" : tournamentSection === "team-create" ? "Crear equipo" : tournamentSection === "teams" ? "Equipos" : tournamentSection === "overview" ? "Torneos" : enrollmentSection === "send" ? "Registrar" : enrollmentSection === "withdraw" ? "Nueva baja" : enrollmentSection === "withdraw-history" ? "Histórico de bajas" : enrollmentSection === "sanction-new" ? "Nueva sanción" : enrollmentSection === "commission" ? "Comisión disciplinaria" : enrollmentSection === "blacklist" ? "Lista negra" : enrollmentSection === "players" ? "Jugadores" : "Sábana"}</h1><div>
        <button aria-label="Actualizar" title="Actualizar" disabled={busy || catalogBusy} onClick={() => { setPrintRoster(false); setRosterRevision(value => value + 1); void loadCatalog().catch(() => undefined); }}><RefreshCw size={19} /><span>Actualizar</span></button>
        <button aria-label="Cerrar sesión" title="Cerrar sesión" onClick={onLogout}><LogOut size={19} /><span>Cerrar sesión</span></button>
      </div></header>
      {error && <p className="error no-print" role="alert">{error}</p>}
      {message && <p className="no-print" role="status">{message}</p>}
      {catalogError && <p className="error no-print" role="alert">{catalogError} <button onClick={() => void loadCatalog().catch(() => undefined)}>Volver a cargar equipos y torneos</button></p>}
      {catalogBusy && navigation.screen.roster && !rosterTeam ? <p role="status">Cargando equipo…</p> : rosterTeam ? <TeamRosterPage key={`${rosterTeam.id}:${rosterRevision}:${alignmentSheet}`} team={rosterTeam} tournament={catalog.tournaments.find(row => row.id === rosterTeam.tournament)} token={token} autoPrint={printRoster} alignment={alignmentSheet} onBack={() => { navigation.back(); setPrintRoster(false); }} /> : tournamentSection !== null ? <section className={`operator-controls enrollment-tournament-workspace no-print${tournamentSection === "create" ? " enrollment-tournament-create" : ""}`}>
        <TournamentsPanel token={token} data={tournamentData} scope="adult" setupOnly
          onTeamsReused={async () => { await loadCatalog(); }}
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
          onViewTeamRoster={item => openRoster(item)}
          onUpdateRegistration={unsupportedAction} onCreateMatch={unsupportedAction} onUpdateMatch={unsupportedAction} />
      </section> : enrollmentSection === "players" ? <PlayersDirectory token={token} revision={rosterRevision} /> : (enrollmentSection === "commission" || enrollmentSection === "blacklist") ? <DisciplinaryRecords key={enrollmentSection} token={token} mode={enrollmentSection} revision={rosterRevision} /> : enrollmentSection === "sanction-new" ? <NewSanction token={token} catalog={catalog} /> : enrollmentSection === "withdraw-history" ? <WithdrawalHistory token={token} revision={rosterRevision} renderSignature={(document, name) => <PrivateImage document={document} token={token} alt={`Firma de la baja de ${name}`} />} /> : (enrollmentSection === "send" || enrollmentSection === "withdraw") ?
      <section className="operator-controls no-print">
        <h2>{enrollmentSection === "withdraw" ? "Nueva baja" : "Registrar"}</h2>
        <form onSubmit={invite} className="control-grid">
          <label>Torneo<select required value={inviteTournament} disabled={catalogBusy || busy}
            onChange={event => chooseTournament(event.target.value)}><option value="">Selecciona un torneo</option>
            {catalog.tournaments.map(item => <option key={item.id} value={item.id}>{item.name} · {catalog.sites.find(site => site.id === item.site)?.name}</option>)}</select></label>
          <label>Equipo del torneo<select required value={inviteTeam} disabled={catalogBusy || busy || !inviteTournament}
            onChange={event => { setInviteTeam(event.target.value); setLink(""); }}><option value="">Selecciona un equipo</option>
            {availableTeams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button disabled={busy || catalogBusy || !inviteTeam} className="primary">Crear enlace</button>
          {enrollmentSection === "send" && <button ref={localButtonRef} type="button" disabled={busy || catalogBusy || !inviteTeam} onClick={() => void createInvitation(true)}><UserPlus size={18} aria-hidden="true" />Registro local</button>}
        </form>
        {!catalogBusy && !catalog.tournaments.length && <p>Primero crea un torneo en la subsección «Crear torneo» del menú izquierdo.</p>}
        {!catalogBusy && inviteTournament && !availableTeams.length && <p>Este torneo todavía no tiene equipos.</p>}
        {link && <div className="share-link"><input readOnly value={link} aria-label={enrollmentSection === "withdraw" ? "Enlace de baja" : "Enlace de inscripción"} /><div>
          <button onClick={() => { void navigator.clipboard.writeText(link).then(() => setMessage("Enlace copiado."), () => setError("Copia el enlace manualmente.")); }}>Copiar enlace</button>
          <a className="enrollment-whatsapp-share" href={"https://wa.me/?text=" + encodeURIComponent((enrollmentSection === "withdraw" ? "Completa y firma la baja del equipo aquí: " : "Hola, completa y firma tu inscripción aquí: ") + link)} target="_blank" rel="noreferrer"><WhatsAppIcon /><span>Compartir por WhatsApp</span></a>
          <a href={link} target="_blank" rel="noreferrer">Ver formulario</a>
        </div></div>}
      </section> : <section className="enrollment-sabana-directory">
        <section className="operator-controls no-print">
          <div className="control-grid enrollment-sabana-filters">
            <label>Torneo<select value={tournament} disabled={catalogBusy} onChange={event => { setTournament(event.target.value); setTeam(""); }}>
              <option value="">Todos los torneos</option>{catalog.tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Equipo<select value={team} disabled={catalogBusy} onChange={event => setTeam(event.target.value)}>
              <option value="">Todos los equipos</option>{catalog.teams.filter(item => !tournament || String(item.tournament) === tournament).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Buscar equipo<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          </div>
        </section>
        <p className="enrollment-sabana-count" role="status">{catalogBusy ? "Cargando equipos…" : `${filteredTeams.length} equipos`}</p>
        <div className="tournament-directory-scroll" tabIndex={0} role="region" aria-label="Equipos y sábanas">
          <table className="tournament-directory-table enrollment-sabana-table">
            <thead><tr><th scope="col">Equipo</th><th scope="col">Torneo</th><th scope="col">Sede</th><th scope="col">Estado</th><th scope="col">Detalle</th><th scope="col">Imprimir / PDF</th></tr></thead>
            <tbody>{!catalogBusy && filteredTeams.map(item => {
              const tournamentRow = catalog.tournaments.find(row => row.id === item.tournament);
              return <tr key={item.id}><th scope="row">{item.name}</th><td>{tournamentRow?.name || "Sin torneo"}</td>
                <td>{catalog.sites.find(site => site.id === tournamentRow?.site)?.name || "—"}</td>
                <td>{item.is_active ? "Activo" : "Inactivo"}</td>
                <td><button type="button" className="enrollment-sabana-action" aria-label={`Ver sábana de ${item.name}`} onClick={() => openRoster(item)}><Eye size={16} aria-hidden="true" />Ver sábana</button></td>
                <td><button type="button" className="enrollment-sabana-action" aria-label={`Imprimir o guardar PDF de ${item.name}`} onClick={() => openRoster(item, true)}><Printer size={16} aria-hidden="true" />Imprimir / PDF</button></td>
              </tr>;
            })}
            {!catalogBusy && !filteredTeams.length && <tr><td colSpan={6} className="tournament-directory-empty">No hay equipos con estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
    <dialog ref={localDialogRef} className="local-enrollment-dialog no-print" aria-labelledby="local-enrollment-title" onCancel={event => { event.preventDefault(); closeLocalRegistration(); }}>
      {localRegistration && <><header className="local-enrollment-header"><div><h2 id="local-enrollment-title">Registro local</h2><p>{localRegistration.tournament} · {localRegistration.team}</p></div><button type="button" disabled={localSaving} onClick={closeLocalRegistration}>{localCompleted ? 'Finalizar registro local' : 'Cerrar registro local'}</button></header><div className="local-enrollment-content"><PublicPlayerEnrollment key={localRegistration.token} invitation={localRegistration.token} embedded onCompleted={setLocalCompleted} onBusyChange={setLocalSaving} /></div></>}
    </dialog>
  </main>;
}
