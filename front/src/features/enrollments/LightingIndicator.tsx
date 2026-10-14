import { Sun, TriangleAlert } from 'lucide-react';
import type { LightingResult } from './photoLighting';
import './photoLighting.css';

export function LightingIndicator({ result, checking = false, unavailable = false }: {
  result: LightingResult | null; checking?: boolean; unavailable?: boolean;
}) {
  if (!result && !checking && !unavailable) return null;
  const good = result?.sufficient;
  return <div className={`photo-lighting ${result ? (good ? 'is-good' : 'is-dark') : 'is-checking'}`} role="status" aria-live="polite">
    {result && !good ? <TriangleAlert size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
    <span>{result ? (good ? 'Iluminación suficiente' : 'Poca luz · ilumina mejor la cara o el documento')
      : unavailable ? 'No se pudo revisar la iluminación' : 'Revisando iluminación…'}</span>
  </div>;
}
