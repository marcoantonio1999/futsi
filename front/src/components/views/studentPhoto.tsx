import { useEffect, useId, useState } from "react";
import { Camera, Upload, X } from "lucide-react";
import { API_URL } from "../../api";
import type { Student } from "../../types";
import { Avatar } from "./shared";

export function StudentAvatar({ student, token, onPhotoUnavailable }: { student: Student; token: string; onPhotoUnavailable?: (unavailable: boolean) => void }) {
  const [privateUrl, setPrivateUrl] = useState("");
  useEffect(() => {
    setPrivateUrl("");
    if (!student.photo_url?.startsWith("supabase://")) return;
    const controller = new AbortController();
    let objectUrl = "";
    fetch(`${API_URL}/students/${student.id}/photo-content/`, {
      headers: { Authorization: `Token ${token}` }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) { onPhotoUnavailable?.(true); return; }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setPrivateUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) onPhotoUnavailable?.(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [student.id, student.photo_url, token, onPhotoUnavailable]);
  return <Avatar name={student.full_name} imageUrl={privateUrl || student.photo_url || student.photo} />;
}

export function StudentPhotoInput({ file, onChange, disabled, current }: {
  file: File | null; onChange: (file: File | null) => void; disabled?: boolean; current?: React.ReactNode;
}) {
  const id = useId();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="student-photo-input">
    <div className="student-photo-preview">{preview ? <img src={preview} alt="Vista previa de la foto del alumno" /> : current || <Camera size={28} />}</div>
    <div className="min-w-0 flex-1">
      <p className="font-semibold">Foto del alumno <span className="student-optional">Opcional</span></p>
      <p className="student-hint">JPG, PNG o WebP · Máximo 5 MB. Se subirá al guardar al alumno.</p>
      <label className={`student-button secondary student-upload-label ${disabled ? "opacity-50" : ""}`}>
        <Upload size={15} /> {file || current ? "Cambiar foto" : "Seleccionar foto"}
        <input id={id} aria-label="Seleccionar foto del alumno" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => {
          const next = event.target.files?.[0];
          event.target.value = "";
          if (!next) return;
          if (!["image/jpeg", "image/png", "image/webp"].includes(next.type)) { setError("Selecciona una foto JPG, PNG o WebP."); return; }
          if (next.size > 5 * 1024 * 1024) { setError("La foto debe pesar como máximo 5 MB."); return; }
          setError(""); onChange(next);
        }} />
      </label>
      {file && <div className="student-file-name"><span>{file.name}</span><button type="button" disabled={disabled} aria-label="Quitar foto seleccionada" onClick={() => { setError(""); onChange(null); }}><X size={16} /></button></div>}
      {error && <p role="alert" className="student-error">{error}</p>}
    </div>
  </div>;
}
