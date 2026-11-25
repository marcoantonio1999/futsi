import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/enrollment-ui";
import type { openRegistrationPdf } from "./renderRegistrationPdf";

type Document = Awaited<ReturnType<typeof openRegistrationPdf>>;

export function EnrollmentPdfPreview({ blob, title, onReady, onError, onZoom }: {
  blob: Blob; title: string; onReady: () => void; onError: () => void;
  onZoom: (image: { url: string; title: string }) => void;
}) {
  const [document, setDocument] = useState<Document>();
  const [page, setPage] = useState(1);
  const [image, setImage] = useState<{ page: number; url: string }>();
  const [failed, setFailed] = useState(false);
  const viewed = useRef(new Set<number>());
  useEffect(() => {
    const controller = new AbortController();
    void import("./renderRegistrationPdf").then(({ openRegistrationPdf }) => openRegistrationPdf(blob, controller.signal))
      .then(pdf => { if (!controller.signal.aborted) setDocument(pdf); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [blob]);
  useEffect(() => {
    if (!document) return;
    let current = true;
    let url: string | undefined;
    void document.render(page, true).then(result => {
      if (!current) return;
      url = URL.createObjectURL(result);
      setImage({ page, url });
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
  }, [document, page]);
  useEffect(() => { if (failed) onError(); }, [failed, onError]);
  const url = image?.page === page ? image.url : undefined;
  const pageTitle = `${title} · Página ${page}`;
  return <div className="enrollment-pdf-pages">
    {url ? <button type="button" className="enrollment-preview-open" onClick={() => onZoom({ url, title: pageTitle })} aria-label={`Ampliar ${pageTitle}`}>
      <img src={url} alt={pageTitle} onLoad={() => {
        viewed.current.add(page);
        if (viewed.current.size === document?.count) onReady();
      }} onError={onError} />
    </button> : <p role="status">Cargando página…</p>}
    {document && document.count > 1 && <div className="pagination">
      <Button type="button" disabled={page === 1 || !url} onClick={() => setPage(value => value - 1)}>Anterior</Button>
      <span aria-live="polite">Página {page} de {document.count}</span>
      <Button type="button" disabled={page === document.count || !url} onClick={() => setPage(value => value + 1)}>Siguiente</Button>
    </div>}
  </div>;
}
