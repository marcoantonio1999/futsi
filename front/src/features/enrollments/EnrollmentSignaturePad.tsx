import {useRef} from 'react';
import {Button, Card} from '../../components/ui/enrollment-ui';
export function Signature({ label, onChange }: { label: string; onChange: (blob: Blob | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const previous = useRef<[number, number] | null>(null);
  function point(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - bounds.left) * 900 / bounds.width, (event.clientY - bounds.top) * 360 / bounds.height];
  }
  return <Card as="section" className="signature-box">
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
    <Button type="button" className="quiet" onClick={() => {
      hasInk.current = false; canvas.current?.getContext("2d")?.clearRect(0, 0, 900, 360); onChange(null);
    }}>Borrar firma</Button>
  </Card>;
}

