import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import { Button, Card, Input, Label } from "../../components/ui/enrollment-ui";
import { fetchEnrollmentDocument } from "./fetchEnrollmentDocument";
import { renderRegistrationPdf } from "./renderRegistrationPdf";
import "./enrollmentApproval.css";
type Doc = { id: number; kind: string };
type RecordRow = {
  id: number;
  name: string;
  birth_date: string;
  team: string;
  tournament: string;
  phone: string;
  phone_secondary: string;
  guardian_name: string;
  identity_type: string;
  payment_reference?: string;
  document_checklist?: string[];
  signed_at: string;
  terms_text: string[];
  documents: Doc[];
  is_delegate: boolean;
};
const labels: Record<string, string> = {
  player_photo: "Foto del jugador",
  minor_credential: "Documento del menor",
  curp: "CURP",
  guardian_ine_front: "INE del tutor frente",
  guardian_ine_back: "INE del tutor reverso",
  guardian_signature: "Firma del tutor",
  player_signature: "Firma del jugador",
  ine_front: "INE frente",
  ine_back: "INE reverso",
  identity_document: "Pasaporte / cartilla",
};
export function EnrollmentApproval({
  token,
  onChanged,
}: {
  token: string;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<RecordRow[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [ready, setReady] = useState<number[]>([]);
  const [documents, setDocuments] = useState<Record<number, {url?: string; mime?: string; pages?: string[]; error?: string}>>({});
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    apiRequest<{ results: RecordRow[]; count: number }>(
      "/player-enrollments/?" +
        new URLSearchParams({
          pending_validation: "true",
          page: String(page),
          search,
        }),
      token,
      { signal: c.signal },
    )
      .then((r) => {
        setRows(r.results);
        setCount(r.count);
        if (!r.results.length && r.count > 0 && page > 1) setPage((p) => p - 1);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [token, page, search, revision]);
  useEffect(() => {
    setDocuments({});
    setReady([]);
    if (!selected) return;
    const controller = new AbortController();
    const urls: string[] = [];
    for (const document of selected.documents) {
      void fetchEnrollmentDocument('/player-enrollments/documents/' + document.id + '/', token, controller.signal)
        .then(async response => {
          if (!response.ok) throw Error('El documento no está disponible.');
          const blob = await response.blob();
          if (!blob.size) throw Error('El documento está vacío.');
          if (!blob.type.startsWith('image/') && blob.type !== 'application/pdf') throw Error('Formato no disponible para revisión.');
          if (controller.signal.aborted) return;
          if (blob.type === 'application/pdf') {
            const pages = await renderRegistrationPdf(blob, controller.signal);
            if (!controller.signal.aborted) setDocuments(previous => ({...previous, [document.id]: {pages, mime: blob.type}}));
          } else {
            const url = URL.createObjectURL(blob); urls.push(url);
            setDocuments(previous => ({...previous, [document.id]: {url, mime: blob.type}}));
          }
        })
        .catch(reason => {
          if (!controller.signal.aborted) setDocuments(previous => ({...previous, [document.id]: {error: reason.message}}));
        });
    }
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [selected, token]);
  function documentReady(id: number) {
    setReady(previous => previous.includes(id) ? previous : [...previous, id]);
  }
  function documentFailed(id: number) {
    setDocuments(previous => ({...previous, [id]: {...previous[id], error: 'No se pudo mostrar el documento.'}}));
    setReady(previous => previous.filter(value => value !== id));
  }
  const missingDocuments = (() => {
    if (!selected) return [];
    const signedDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(selected.signed_at));
    const [year, month, day] = signedDate.split("-").map(Number),
      [birthYear, birthMonth, birthDay] = selected.birth_date
        .split("-")
        .map(Number);
    const minor =
      year -
        birthYear -
        (month < birthMonth || (month === birthMonth && day < birthDay)
          ? 1
          : 0) <
      18;
    const required = minor
      ? [
          "player_photo",
          "minor_credential",
          "guardian_ine_front",
          "guardian_ine_back",
          "guardian_signature",
        ]
      : [
          "player_photo",
          "player_signature",
          ...(selected.identity_type === "ine"
            ? ["ine_front", "ine_back"]
            : selected.identity_type === "curp"
              ? ["curp"]
              : ["identity_document"]),
        ];
    return required.filter(
      (kind) => !selected.documents.some((document) => document.kind === kind),
    );
  })();
  function open(row: RecordRow) {
    setSelected(row);
    setReady([]);
    setDocuments({});
    setError("");
    setMessage("");
  }
  async function approve() {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest(
        "/player-enrollments/" + selected.id + "/validate/",
        token,
        {
          method: "POST",
          body: JSON.stringify({ confirmed: true, documents_reviewed: ready }),
        },
      );
      setMessage("Inscripción validada. Ya puede aparecer en la sábana.");
      setSelected(null);
      setRevision((r) => r + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo validar.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="enrollment-approval no-print">
      <header>
        <h2>Validar inscripciones</h2>
        <p>
          Revisa la hoja y los documentos antes de autorizar su aparición en la
          sábana.
        </p>
      </header>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <>
          <Button
            disabled={saving}
            onClick={() => setSelected(null)}
          >
            Volver a pendientes
          </Button>
          <Card className="enrollment-approval-sheet">
            <h3>Hoja de inscripción · Folio {selected.id}</h3>
            <dl>
              {[
                ["Nombre completo", selected.name],
                ["Nacimiento", selected.birth_date],
                ["Equipo", selected.team],
                ["Torneo", selected.tournament],
                ["Teléfono", selected.phone],
                ["Teléfono adicional", selected.phone_secondary || "—"],
                ["Tutor", selected.guardian_name || "—"],
                ["Identificación", selected.identity_type],
                ["Referencia de pago", selected.payment_reference || "—"],
                [
                  "Documentos declarados",
                  (selected.document_checklist || []).join(", ") || "—",
                ],
                [
                  "Fecha de inscripción",
                  new Date(selected.signed_at).toLocaleString("es-MX"),
                ],
                ["Delegado", selected.is_delegate ? "Sí" : "No"],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <details>
              <summary>Condiciones aceptadas</summary>
              <ul>
                {selected.terms_text.map((term, i) => (
                  <li key={i}>{term}</li>
                ))}
              </ul>
            </details>
          </Card>
          <Card>
            <h3>Documentos y firmas</h3>
            {missingDocuments.length > 0 && (
              <p className="error" role="alert">
                Faltan documentos obligatorios:{" "}
                {missingDocuments
                  .map((kind) => labels[kind] || kind)
                  .join(", ")}
                . No se puede validar.
              </p>
            )}
            <div className="enrollment-approval-docs">
              {selected.documents.map(document => {
                const preview = documents[document.id];
                const title = labels[document.kind] || document.kind;
                return <article key={document.id} className="enrollment-document-preview">
                  <h4>{title}</h4>
                  {preview?.error ? <p role="alert" className="error">{preview.error} No se puede validar hasta cargarlo.</p>
                    : !preview?.url && !preview?.pages ? <p role="status">Cargando documento privado…</p>
                    : preview.mime === 'application/pdf' ? <div className="enrollment-pdf-pages">{preview.pages?.map((url, index) => <img key={index} src={url} alt={`${title} · Página ${index+1}`} onLoad={event => {
                      const images = event.currentTarget.parentElement?.querySelectorAll('img');
                      if (images && Array.from(images).every(image => image.complete && image.naturalWidth > 0)) documentReady(document.id);
                    }} onError={() => documentFailed(document.id)} />)}</div>
                    : <img src={preview.url} alt={title} onLoad={() => documentReady(document.id)} onError={() => documentFailed(document.id)} />}
                </article>;
              })}
            </div>
            {!selected.documents.length && <p className="error">No hay documentos disponibles. No se puede validar.</p>}
          </Card>
          <Card className="enrollment-approval-confirm">
            <p>Al validar confirmas que la hoja, las fotos, las firmas y los documentos son correctos.</p>
            <Button
              className="primary"
              disabled={
                saving ||
                !!missingDocuments.length ||
                !selected.documents.length ||
                selected.documents.some((d) => !ready.includes(d.id))
              }
              onClick={() => void approve()}
            >
              {saving ? "Validando…" : "Validar inscripción"}
            </Button>
          </Card>
        </>
      ) : (
        <Card>
          <Label>
            Buscar inscripción
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Label>
          <p role="status">
            {loading
              ? "Cargando pendientes…"
              : `${count} inscripciones pendientes de validar`}
          </p>
          <div className="enrollment-approval-list">
            {!loading &&
              rows.map((row) => (
                <article key={row.id}>
                  <div>
                    <strong>{row.name}</strong>
                    <p>
                      {row.tournament} · {row.team}
                    </p>
                    <small>
                      Folio {row.id} ·{" "}
                      {new Date(row.signed_at).toLocaleString("es-MX")}
                    </small>
                  </div>
                  <Button onClick={() => open(row)}>Revisar inscripción</Button>
                </article>
              ))}
          </div>
          {!loading && !count && (
            <p>No hay inscripciones pendientes con estos filtros.</p>
          )}
          <div className="enrollment-approval-pages">
            <Button
              disabled={loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>Página {page}</span>
            <Button
              disabled={loading || page * 25 >= count}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </Card>
      )}
    </section>
  );
}
