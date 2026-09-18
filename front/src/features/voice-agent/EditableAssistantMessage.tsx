import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { MessageBody } from "./MessageBody";
import { inputClass } from "./model";

export function EditableAssistantMessage({ title, hint, value, savedValue, disabled, onChange }: {
  title: string; hint: string; value: string; savedValue: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState("");
  useEffect(() => { setEditing(false); }, [savedValue]);
  return <article className="comm-message-editor">
    <header>
      <h4>{title}</h4>
      {!editing && <button type="button" aria-label={`Editar ${title.toLowerCase()}`} title={`Editar ${title.toLowerCase()}`}
        disabled={disabled} onClick={() => { setOriginal(value); setEditing(true); }}><Pencil size={16} /> Editar</button>}
    </header>
    {editing ? <div className="grid gap-3">
      <label className="grid gap-1"><span className="sr-only">{title}</span>
        <textarea autoFocus className={`${inputClass} min-h-40 py-2`} maxLength={2000}
          value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />
      </label>
      <p className="text-xs">{hint} Puedes usar *texto* para negritas.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={disabled || !value.trim()} onClick={() => setEditing(false)}><Check size={16} /> Ver vista previa</button>
        <button type="button" disabled={disabled} onClick={() => { onChange(original); setEditing(false); }}><X size={16} /> Cancelar edición</button>
      </div>
      <p className="text-xs">Para aplicar el texto al bot, pulsa Guardar configuración.</p>
    </div> : <><MessageBody body={value || "Sin mensaje. Pulsa Editar para escribirlo."} /><p className="mt-3 text-xs">{hint}</p></>}
  </article>;
}
