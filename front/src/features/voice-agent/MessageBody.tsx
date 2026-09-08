import { FileImage } from "lucide-react";
import { mediaLabel } from "./communicationUtils";

export function MessageBody({ body }: { body: string }) {
  if (body.trim().toLowerCase() === "[reaction]") return <span className="comm-muted">Reacción a un mensaje</span>;
  const media = mediaLabel(body);
  if (media) return <span className="comm-attachment"><FileImage size={18} /><span><strong>{media}</strong><small>Vista previa no disponible en este registro</small></span></span>;
  const parts = body.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return <>{parts.map((part, index) => part.startsWith("*") && part.endsWith("*") ? <strong key={index}>{part.slice(1, -1)}</strong> : part.startsWith("_") && part.endsWith("_") ? <em key={index}>{part.slice(1, -1)}</em> : part.startsWith("~") && part.endsWith("~") ? <s key={index}>{part.slice(1, -1)}</s> : part)}</>;
}
