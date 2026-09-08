import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapPin } from "lucide-react";
import { money } from "../../utils/format";
import type { Site } from "../../types";

export function SitesMap({ sites, siteRows }: {
  sites: Site[];
  siteRows: Array<{ id: number; name: string; students: number; balance: number; utility: number; attendance?: number }>;
}) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const rows = useMemo(() => siteRows.map(row => ({ ...row, site: sites.find(site => site.id === row.id) })), [siteRows, sites]);
  const points = useMemo(() => rows.filter(row => row.site?.latitude != null && row.site?.longitude != null && row.site.latitude !== "" && row.site.longitude !== "")
    .map(row => ({ row, lat: Number(row.site!.latitude), lng: Number(row.site!.longitude) }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180), [rows]);

  function popupContent(group: typeof points) {
    const container = document.createElement("div");
    group.forEach(point => {
      const item = document.createElement("p");
      item.style.margin = "6px 0";
      const title = document.createElement("strong");
      title.textContent = point.row.name;
      item.append(title, document.createElement("br"), document.createTextNode(point.row.site?.address || "Sin dirección registrada"), document.createElement("br"), document.createTextNode("Saldo actual: $" + money(point.row.balance)));
      container.append(item);
    });
    container.style.maxHeight = "220px";
    container.style.overflowY = "auto";
    return container;
  }

  useEffect(() => {
    if (!mapNode.current || !points.length) return;
    const map = L.map(mapNode.current, { zoomControl: true, scrollWheelZoom: false });
    mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    function renderMarkers() {
      layer.clearLayers();
      const groups: Array<typeof points> = [];
      points.forEach(point => {
        const pixel = map.latLngToLayerPoint([point.lat, point.lng]);
        const group = groups.find(items => map.latLngToLayerPoint([items[0].lat, items[0].lng]).distanceTo(pixel) < 44);
        if (group) group.push(point); else groups.push([point]);
      });
      groups.forEach(group => {
        const point = group[0];
        const icon = document.createElement("div");
        icon.textContent = group.length > 1 ? String(group.length) : point.row.name.slice(0, 2).toUpperCase();
        icon.style.cssText = "display:grid;place-items:center;width:36px;height:36px;border:3px solid white;border-radius:50%;color:white;font-size:12px;font-weight:700;box-shadow:0 2px 7px #0003;background:" + (group.length > 1 ? "#334155" : point.row.balance > 0 ? "#b45309" : "#047857");
        const marker = L.marker([point.lat, point.lng], {
          title: group.length > 1 ? group.length + " sedes cercanas" : point.row.name,
          icon: L.divIcon({ className: "", html: icon, iconSize: [36, 36], iconAnchor: [18, 18] }),
        }).addTo(layer).bindPopup(popupContent(group));
        marker.on("click", () => {
          if (group.length === 1) setSelected(point.row.id);
          else if (map.getZoom() < 18 && group.some(item => item.lat !== point.lat || item.lng !== point.lng)) {
            map.fitBounds(L.latLngBounds(group.map(item => [item.lat, item.lng])), { maxZoom: map.getZoom() + 3, padding: [40, 40] });
          }
        });
      });
    }
    map.fitBounds(L.latLngBounds(points.map(point => [point.lat, point.lng])), { maxZoom: 13, padding: [36, 36] });
    renderMarkers();
    map.on("zoomend", renderMarkers);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(mapNode.current);
    return () => { resize.disconnect(); mapRef.current = null; map.remove(); };
  }, [points]);

  function locate(id: number) {
    const point = points.find(point => point.row.id === id);
    if (!point || !mapRef.current) return;
    setSelected(id);
    mapRef.current.setView([point.lat, point.lng], 17, { animate: true });
    L.popup().setLatLng([point.lat, point.lng]).setContent(popupContent([point])).openOn(mapRef.current);
    mapNode.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const filteredRows = rows.filter(row => (row.name + " " + row.site?.address).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
    <div className="border-b border-zinc-200 px-4 py-3">
      <h2 className="font-semibold">Mapa de sedes</h2>
      <p className="mt-1 text-xs text-zinc-500">{points.length} de {rows.length} sedes ubicadas. Los círculos con números agrupan sedes cercanas.</p>
      <p className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500"><span>🟠 Con saldo pendiente</span><span>🟢 Sin saldo pendiente</span></p>
    </div>
    <div className="grid min-w-0 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="h-[340px] min-w-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
        {points.length ? <div ref={mapNode} className="h-full w-full" aria-label="Mapa de ubicaciones" /> : <div className="grid h-full place-items-center p-4 text-sm text-zinc-500">No hay sedes con ubicación registrada.</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <label className="text-xs font-medium text-zinc-500">Buscar sede
          <input className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre o dirección" />
        </label>
        <div className="grid max-h-[270px] content-start gap-2 overflow-y-auto pr-1">
          {filteredRows.map(row => {
            const located = points.some(point => point.row.id === row.id);
            return <article key={row.id} className={"min-w-0 rounded-md border p-3 " + (selected === row.id ? "border-emerald-500 bg-emerald-50" : "border-zinc-200")}>
              <p className="text-sm font-semibold">{row.name}</p>
              <p className="mt-1 text-xs text-zinc-500">{row.site?.address || "Sin dirección registrada"} · {row.site?.is_active === false ? "Inactiva" : "Activa"}</p>
              {located ? <button type="button" className="mt-2 flex items-center gap-1 py-1 text-xs font-semibold text-emerald-700" onClick={() => locate(row.id)}><MapPin size={13} />Ver {row.name} en mapa</button> : <p className="mt-2 text-xs text-zinc-500">Sin ubicación registrada</p>}
            </article>;
          })}
          {!filteredRows.length && <p className="py-6 text-sm text-zinc-500">No hay sedes que coincidan.</p>}
        </div>
      </div>
    </div>
  </section>;
}
