import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapPin } from "lucide-react";
import { money } from "../../utils/format";
import type { Site } from "../../types";

export function SitesMap({
  sites,
  siteRows,
}: {
  sites: Site[];
  siteRows: Array<{ id: number; name: string; students: number; balance: number; utility: number; attendance?: number }>;
}) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(
    () =>
      siteRows.map((row) => ({
        ...row,
        site: sites.find((site) => site.id === row.id),
      })),
    [siteRows, sites],
  );
  const points = useMemo(
    () =>
      sites
        .filter((site) => site.latitude && site.longitude)
        .map((site) => ({
          site,
          row: siteRows.find((item) => item.id === site.id),
          lat: Number(site.latitude),
          lng: Number(site.longitude),
        })),
    [siteRows, sites],
  );

  useEffect(() => {
    if (!mapNode.current || points.length === 0) return;
    const map = L.map(mapNode.current, { zoomControl: true, scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    points.forEach((point) => {
      const hasBalance = (point.row?.balance ?? 0) > 0;
      L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="grid size-8 place-items-center rounded-full border-2 ${hasBalance ? "border-red-200 bg-red-600" : "border-emerald-200 bg-emerald-700"} text-xs font-semibold text-white shadow-sm">${point.site.name.slice(0, 2).toUpperCase()}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
      })
        .addTo(map)
        .bindPopup(`<strong>${point.site.name}</strong><br/>${point.site.address || "Sin direccion"}<br/>Saldo: $${money(point.row?.balance ?? 0)}`);
      bounds.extend([point.lat, point.lng]);
    });
    map.fitBounds(bounds.pad(0.25));
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
    };
  }, [points]);

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 className="font-semibold">Sedes</h2>
          <p className="mt-1 text-sm text-zinc-500">Mapa y lista operativa por sede.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{rows.length}</span>
      </div>

      <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_430px]">
        <div className="h-[360px] min-w-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
          {points.length ? <div ref={mapNode} className="h-full w-full" /> : <div className="grid h-full place-items-center text-sm text-zinc-500">No hay sedes con coordenadas.</div>}
        </div>

        <div className="flex h-[360px] min-w-0 flex-col">
          <div className="grid flex-1 gap-2 overflow-y-auto pr-1">
            {rows.map((row) => (
              <article key={row.id} className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">{row.name}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{row.site?.address || "Sin direccion registrada"}</p>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold ${row.site?.is_active === false ? "border-zinc-200 bg-white text-zinc-500" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                    {row.site?.is_active === false ? "Inactiva" : "Activa"}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
                  <SiteMetric label="Alumnos" value={row.students} />
                  <SiteMetric label="Asist." value={row.attendance ?? 0} />
                  <SiteMetric label="Utilidad" value={`$${money(row.utility)}`} />
                  <SiteMetric label="Saldo" value={`$${money(row.balance)}`} tone={row.balance > 0 ? "text-red-700" : "text-zinc-900"} />
                </div>

                <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500">
                  <MapPin size={12} /> {row.site?.latitude && row.site?.longitude ? `${Number(row.site.latitude).toFixed(4)}, ${Number(row.site.longitude).toFixed(4)}` : "Sin coordenadas"}
                </p>
              </article>
            ))}
            {rows.length === 0 && <p className="rounded-md border border-zinc-200 px-3 py-6 text-sm text-zinc-500">No hay sedes registradas.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteMetric({ label, tone = "text-zinc-900", value }: { label: string; tone?: string; value: number | string }) {
  return (
    <div className="rounded-md bg-white px-2 py-1.5">
      <p className="text-[11px] font-medium uppercase text-zinc-500">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
