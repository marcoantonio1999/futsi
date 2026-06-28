import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import type { Site } from "../../types";
import { SimpleList, TextInput } from "./shared";

export function SitesPanel({ sites, onCreate }: { sites: Site[]; onCreate: (payload: unknown) => void }) {
  const [form, setForm] = useState({ name: "", code: "", address: "", latitude: "", longitude: "", is_active: true, close_editing_after_hours: 24 });

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      ...form,
      latitude: form.latitude || null,
      longitude: form.longitude || null,
    });
    setForm({ name: "", code: "", address: "", latitude: "", longitude: "", is_active: true, close_editing_after_hours: 24 });
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus size={16} /> Nueva sede
        </h2>
        <div className="mt-4 grid gap-3">
          <TextInput label="Nombre" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextInput label="Codigo" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextInput label="Direccion" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Latitud" type="number" step="0.000001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
            <TextInput label="Longitud" type="number" step="0.000001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          </div>
          <TextInput
            label="Horas para editar"
            type="number"
            min={1}
            value={form.close_editing_after_hours}
            onChange={(e) => setForm({ ...form, close_editing_after_hours: Number(e.target.value) })}
          />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Guardar sede
          </button>
        </div>
      </form>
      <SimpleList
        title="Sedes"
        count={sites.length}
        rows={sites.map((site) => ({
          id: site.id,
          title: site.name,
          subtitle: `${site.address || "Sin direccion"} - ${site.latitude ?? "sin lat"}, ${site.longitude ?? "sin lng"} - ${site.student_count ?? 0} alumnos`,
        }))}
      />
    </>
  );
}
