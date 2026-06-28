import { useEffect, useRef } from "react";
import L from "leaflet";
import { money } from "../../utils/format";
import type { Site } from "../../types";

export function SitesMap({
  sites,
  siteRows,
}: {
  sites: Site[];
  siteRows: Array<{ id: number; name: string; students: number; balance: number; utility: number }>;
}) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const points = sites
    .filter((site) => site.latitude && site.longitude)
    .map((site) => ({
      site,
      row: siteRows.find((item) => item.id === site.id),
      lat: Number(site.latitude),
      lng: Number(site.longitude),
    }));

  useEffect(() => {
    if (!mapNode.current || points.length === 0) return;
    const map = L.map(mapNode.current, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    points.forEach((point) => {
      const hasRisk = (point.row?.balance ?? 0) > 0;
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="grid size-9 place-items-center rounded-full border-2 ${hasRisk ? "border-red-200 bg-red-600" : "border-emerald-200 bg-emerald-700"} text-xs font-semibold text-white shadow-sm">${point.site.name.slice(0, 2).toUpperCase()}</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      }).addTo(map);
      marker.bindPopup(`
        <strong>${point.site.name}</strong><br/>
        ${point.site.address || "Sin direccion"}<br/>
        ${point.row?.students ?? 0} alumnos<br/>
        Saldo: $${money(point.row?.balance ?? 0)}
      `);
      bounds.extend([point.lat, point.lng]);
    });

    map.fitBounds(bounds.pad(0.25));
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
    };
  }, [sites, siteRows]);

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 className="font-semibold">Mapa de sedes</h2>
          <p className="mt-1 text-sm text-zinc-500">Mapa real con OpenStreetMap para direccion y control operativo.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{points.length}</span>
      </div>
      <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-[320px] min-w-0 overflow-hidden rounded-md border border-zinc-200 sm:min-h-[360px]">
          {points.length > 0 ? (
            <div ref={mapNode} className="h-[320px] w-full sm:h-[360px]" />
          ) : (
            <div className="grid h-[320px] place-items-center text-sm text-zinc-500 sm:h-[360px]">No hay sedes con coordenadas.</div>
          )}
        </div>
        <div className="grid min-w-0 gap-2">
          {points.map((point) => (
            <div key={point.site.id} className="min-w-0 rounded-md border border-zinc-200 px-3 py-2 text-sm">
              <p className="font-medium">{point.site.name}</p>
              <p className="mt-1 break-words text-zinc-500">{point.site.address}</p>
              <p className="mt-1 break-words font-mono text-xs text-zinc-500">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</p>
            </div>
          ))}
          {points.length === 0 && <p className="rounded-md border border-zinc-200 px-3 py-6 text-sm text-zinc-500">No hay sedes con coordenadas.</p>}
        </div>
      </div>
    </section>
  );
}
