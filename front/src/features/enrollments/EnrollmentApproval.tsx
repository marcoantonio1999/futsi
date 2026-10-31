import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import { Button, Card, Input, Label } from "../../components/ui/enrollment-ui";
import { fetchEnrollmentDocument } from "./fetchEnrollmentDocument";
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
  minor_credential: "Credencial del menor",
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
  const [selected, setSelected] = useState<RecordRow | null>(null),
    [doc, setDoc] = useState<Doc | null>(null),
    [reviewed, setReviewed] = useState<number[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(
      null,
    ),
    [docError, setDocError] = useState("");
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
    setPreview(null);
    setDocError("");
    if (!doc) return;
    const c = new AbortController();
    let url = "";
    fetchEnrollmentDocument(
      "/player-enrollments/documents/" + doc.id + "/",
      token,
      c.signal,
    )
      .then(async (r) => {
        if (!r.ok)
          throw Error(
            "El documento no está disponible. No se puede marcar como revisado.",
          );
        const blob = await r.blob();
        if (!blob.size) throw Error("El documento está vacío.");
        if (!blob.type.startsWith("image/") && blob.type !== "application/pdf")
          throw Error("Formato no disponible para revisión.");
        if (c.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, mime: blob.type });
      })
      .catch((e) => {
        if (!c.signal.aborted) setDocError(e.message);
      });
    return () => {
      c.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, token]);
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
          "curp",
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
    setDoc(row.documents[0] || null);
    setReviewed([]);
    setConfirmed(false);
    setError("");
    setMessage("");
  }
  function markReviewed() {
    if (doc)
      setReviewed((ids) => (ids.includes(doc.id) ? ids : [...ids, doc.id]));
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
          body: JSON.stringify({ confirmed, documents_reviewed: reviewed }),
        },
      );
      setMessage("Inscripción validada. Ya puede aparecer en la sábana.");
      setSelected(null);
      setDoc(null);
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
            onClick={() => {
              setSelected(null);
              setDoc(null);
            }}
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
            <p>
              {reviewed.length} de {selected.documents.length} revisados
            </p>
            <div className="enrollment-approval-docs">
              {selected.documents.map((d) => (
                <Button
                  key={d.id}
                  aria-pressed={doc?.id === d.id}
                  onClick={() => setDoc(d)}
                >
                  {labels[d.kind] || d.kind}
                  {reviewed.includes(d.id) ? " · Revisado" : ""}
                </Button>
              ))}
            </div>
            {!selected.documents.length && (
              <p className="error">
                No hay documentos disponibles. No se puede validar.
              </p>
            )}
            {doc && (
              <div className="enrollment-document-preview">
                <h4>{labels[doc.kind] || doc.kind}</h4>
                {docError ? (
                  <p role="alert" className="error">
                    {docError}
                  </p>
                ) : !preview ? (
                  <p role="status">Cargando documento privado…</p>
                ) : preview.mime === "application/pdf" ? (
                  <iframe
                    title={labels[doc.kind] || doc.kind}
                    src={preview.url}
                    onLoad={markReviewed}
                  />
                ) : (
                  <img
                    src={preview.url}
                    alt={labels[doc.kind] || doc.kind}
                    onLoad={markReviewed}
                    onError={() =>
                      setDocError(
                        "No se pudo mostrar la imagen. No se puede marcar como revisada.",
                      )
                    }
                  />
                )}
              </div>
            )}
          </Card>
          <Card className="enrollment-approval-confirm">
            <Label>
              <Input
                type="checkbox"
                checked={confirmed}
                disabled={saving}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Revisé la hoja, las firmas y los documentos. Confirmo que los
              datos son correctos.
            </Label>
            <Button
              className="primary"
              disabled={
                saving ||
                !confirmed ||
                !!missingDocuments.length ||
                !selected.documents.length ||
                selected.documents.some((d) => !reviewed.includes(d.id))
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
