import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Dialog } from "../../components/ui/enrollment-ui";
import "./enrollmentApproval.css";

export function DocumentZoom({url, title, onClose}: {url: string; title: string; onClose: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const pendingZoom = useRef<{x: number; y: number; relativeX: number; relativeY: number} | null>(null);
  const [zoom, setZoom] = useState(100);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const element = viewer.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      setZoom(current => {
        const next = Math.max(100, Math.min(600, current * Math.exp(-event.deltaY * .002)));
        if (next !== current) pendingZoom.current = {x, y, relativeX: (element.scrollLeft + x) / current, relativeY: (element.scrollTop + y) / current};
        return next;
      });
    };
    element.addEventListener("wheel", wheel, {passive: false});
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  useLayoutEffect(() => {
    const target = pendingZoom.current, element = viewer.current;
    if (target && element) {
      element.scrollLeft = target.relativeX * zoom - target.x;
      element.scrollTop = target.relativeY * zoom - target.y;
      pendingZoom.current = null;
    }
  }, [zoom]);
  return <Dialog ref={dialog} className="enrollment-image-dialog no-print" aria-label={`Ampliar ${title}`} onCancel={event => {event.preventDefault(); onClose();}}>
    <header><h2>{title}</h2><Button type="button" onClick={onClose} aria-label="Cerrar imagen">✕</Button></header>
    <div ref={viewer} className="enrollment-image-viewer" tabIndex={0} aria-label="Imagen ampliada, desplázate para ver el documento">
      <img src={url} alt={title} style={{width:`${zoom}%`}} />
    </div>
    <footer><Button type="button" onClick={() => setZoom(value => Math.max(100, value - 50))} disabled={zoom === 100}>Reducir</Button>
      <span aria-live="polite">{Math.round(zoom)}%</span><Button type="button" onClick={() => setZoom(value => Math.min(600, value + 50))} disabled={zoom >= 600}>Ampliar</Button>
      <Button type="button" onClick={onClose}>Cerrar</Button></footer>
  </Dialog>;
}
