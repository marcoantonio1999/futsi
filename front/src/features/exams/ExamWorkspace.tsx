import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, X, Plus, FileText, ListChecks, UsersRound } from 'lucide-react';
import './ExamWorkspace.css';
import { examLogo } from './ExamBrand';

export type ExamSection = 'list' | 'create' | 'evaluations' | 'profiles' | 'applications';
const sections = [
  { key: 'create' as const, label: 'Crear examen', path: 'crear', icon: Plus },
  { key: 'list' as const, label: 'Mis exámenes', path: 'mis-examenes', icon: FileText },
  { key: 'evaluations' as const, label: 'Ver evaluaciones', path: 'evaluaciones', icon: ListChecks },
  { key: 'profiles' as const, label: 'Perfiles', path: 'perfiles', icon: UsersRound },
  { key: 'applications' as const, label: 'Formatos postulaciones', path: 'formatos-postulaciones', icon: FileText },
];
export const examSectionLabel = (section: ExamSection) => sections.find(s => s.key === section)!.label;

export function useExamSection(standalone: boolean) {
  const read = (): ExamSection => standalone ? sections.find(s => window.location.hash === `#/examenes/${s.path}`)?.key || 'list' : 'list';
  const [section, setSection] = useState<ExamSection>(read);
  useEffect(() => {
    if (!standalone) return;
    const changed = () => setSection(read());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [standalone]);
  function navigate(next: ExamSection) {
    setSection(next);
    if (standalone) window.location.hash = `/examenes/${sections.find(s => s.key === next)!.path}`;
  }
  return { section, navigate };
}

export function ExamWorkspace({ section, onNavigate, children }: { section: ExamSection; onNavigate: (section: ExamSection) => void; children: ReactNode }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  function close() { drawer.current?.close(); setOpen(false); toggle.current?.focus(); }
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)');
    const changed = () => { if (desktop.matches) { drawer.current?.close(); setOpen(false); } };
    desktop.addEventListener('change', changed);
    return () => desktop.removeEventListener('change', changed);
  }, []);
  const nav = () => <nav aria-label="Menú de exámenes"><p className="exam-nav-label">EVALUACIONES</p>{sections.map(({ key, label, icon: Icon }) => <button type="button" key={key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => { onNavigate(key); if (drawer.current?.open) close(); }}><Icon size={19} aria-hidden="true" /><span>{label}</span></button>)}</nav>;
  return <div className="exam-workspace exam-scope">
    <aside className="exam-sidebar"><p className="exam-nav-heading">Administración de exámenes</p>{nav()}</aside>
    <div className="exam-workspace-main">
      <div className="exam-mobile-toolbar"><button ref={toggle} type="button" aria-label="Abrir menú de exámenes" aria-expanded={open} onClick={() => { drawer.current?.showModal(); setOpen(true); }}><Menu size={22} aria-hidden="true" /></button><span>{examSectionLabel(section)}</span></div>
      {children}
    </div>
    <dialog className="exam-nav-drawer" ref={drawer} aria-label="Navegación de exámenes" onClose={() => setOpen(false)} onClick={e => { if (e.target === e.currentTarget) { const bounds = e.currentTarget.getBoundingClientRect(); if (e.clientX > bounds.right || e.clientX < bounds.left) close(); } }}>
      <div className="exam-drawer-heading"><span className="exam-drawer-brand"><img src={examLogo} alt="" />Exámenes BPower</span><button type="button" aria-label="Cerrar menú de exámenes" onClick={close}><X size={20} aria-hidden="true" /></button></div>{nav()}
    </dialog>
  </div>;
}
