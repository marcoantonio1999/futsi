import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Student } from "../../types";
import { normalizeText } from "../../components/views/shared";
import { StudentAvatar } from "../../components/views/studentPhoto";

export function BillingStudentIdentity({ student, token = "" }: { student: Student; token?: string }) {
  const [failed, setFailed] = useState(false);
  const hasPhoto = Boolean(student.photo_url || student.photo);
  const privatePhoto = student.photo_url?.startsWith("supabase://");
  return <div className="billing-student-identity" onErrorCapture={() => setFailed(true)}>
    <div className="billing-student-photo">
      {hasPhoto && !failed && (!privatePhoto || token) ? <StudentAvatar key={`${student.id}-${student.photo_url}`} student={student} token={token} onPhotoUnavailable={setFailed} /> : <span aria-label="Foto no disponible">{student.full_name.split(" ").filter(Boolean).slice(0, 2).map(name => name[0]).join("")}</span>}
    </div>
    <div><h3 className="font-bold">{student.full_name}</h3><p className="billing-muted">{student.site_name} · {student.group_name || student.category || `Alumno #${student.id}`}</p><p className="billing-muted">Tutor: {student.guardian_name || "Sin tutor registrado"}</p>
      <p className="billing-muted">{!hasPhoto ? "Sin foto registrada. Confirma el nombre y tutor antes de cobrar." : failed || (privatePhoto && !token) ? "No se pudo mostrar la foto. Confirma el nombre y tutor." : "Confirma que sea el alumno correcto antes de cobrar."}</p>
    </div>
  </div>;
}

export function BillingStudentSelect({ students, selected, onSelect }: {
  students: Student[]; selected?: Student; onSelect: (student: Student | null) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState(selected?.full_name || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const needle = normalizeText(query.trim());
  const matches = students.filter(student => normalizeText(`${student.full_name} ${student.guardian_name || ""} ${student.guardian_phone || ""}`).includes(needle)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const suggestions = matches.slice(0, 6);
  const choose = (student: Student) => { setQuery(student.full_name); setOpen(false); setActive(-1); onSelect(student); };
  return <div className="billing-student-select" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id}>¿A quién vas a cobrar?</label>
    <div className="billing-student-input"><input id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
      placeholder="Selecciona o escribe el nombre del alumno" value={query}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={event => { setQuery(event.target.value); onSelect(null); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive(current => suggestions.length ? (event.key === "ArrowDown" ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length - 1 : current - 1)) : -1); }
        if (event.key === "Enter" && open) { event.preventDefault(); if (active >= 0 && suggestions[active]) choose(suggestions[active]); }
        if (event.key === "Escape") { setOpen(false); setActive(-1); }
      }} /><ChevronDown size={18} aria-hidden="true" /></div>
    {open && <div className="billing-student-dropdown"><ul id={`${id}-options`} role="listbox" aria-label="Alumnos sugeridos">
      {suggestions.map((student, index) => <li key={student.id} id={`${id}-option-${index}`} role="option" aria-selected={selected?.id === student.id} className={index === active ? "active" : ""}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(student)}>
        <strong>{student.full_name}</strong><span>{student.site_name} · {student.guardian_name || "Sin tutor"} · #{student.id}</span>
      </li>)}
    </ul><p role="status">{!matches.length ? "No se encontraron alumnos." : matches.length > 6 ? `6 de ${matches.length} coincidencias. Escribe más para afinar la búsqueda.` : `${matches.length} alumno(s). Selecciona uno para ver su foto y cargos.`}</p></div>}
  </div>;
}
