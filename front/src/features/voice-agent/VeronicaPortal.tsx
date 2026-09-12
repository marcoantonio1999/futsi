import { VeronicaPanel } from "./VeronicaPanel";
import "./communications.css";

export default function VeronicaPortal({ token, name, onLogout }: { token: string; name: string; onLogout: () => void }) {
  return <main className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white">
    <header className="flex items-center justify-between border-b p-5 pr-20"><div><h1 className="text-xl font-bold">Comunicaciones · Verónica</h1><p>{name} · Acceso exclusivo a este canal</p></div><button onClick={onLogout} className="rounded border px-4 py-2">Salir</button></header>
    <div className="communications mx-auto max-w-7xl p-5"><VeronicaPanel token={token} /></div>
  </main>;
}
