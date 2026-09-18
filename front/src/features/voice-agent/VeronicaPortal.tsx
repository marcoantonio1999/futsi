import { VeronicaPanel } from "./VeronicaPanel";
import { useState } from 'react';
import { BulkTemplatesPanel } from './BulkTemplatesPanel';
import { VeronicaFiltersPanel } from './VeronicaFiltersPanel';
import "./communications.css";

export default function VeronicaPortal({ token, name, onLogout }: { token: string; name: string; onLogout: () => void }) {
  const [section, setSection] = useState<'manual' | 'bulk' | 'filters'>('manual');
  return <main className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white">
    <header className="flex items-center justify-between border-b p-5 pr-20"><div><h1 className="text-xl font-bold">Comunicaciones · Verónica</h1><p>{name} · Acceso exclusivo a este canal</p></div><button onClick={onLogout} className="rounded border px-4 py-2">Salir</button></header>
    <nav aria-label="Secciones de Verónica" className="flex flex-wrap gap-3 p-5"><button className="rounded border px-4 py-2" aria-pressed={section === 'manual'} onClick={() => setSection('manual')}>Mensajes y PDF</button><button className="rounded border px-4 py-2" aria-pressed={section === 'bulk'} onClick={() => setSection('bulk')}>Envío masivo de plantillas</button><button className="rounded border px-4 py-2" aria-pressed={section === 'filters'} onClick={() => setSection('filters')}>Filtros de RH</button></nav>
    <div className="communications mx-auto max-w-7xl p-5">{section === 'manual' ? <VeronicaPanel token={token} /> : section === 'bulk' ? <BulkTemplatesPanel token={token} kind="veronica" /> : <VeronicaFiltersPanel token={token} />}</div>
  </main>;
}
