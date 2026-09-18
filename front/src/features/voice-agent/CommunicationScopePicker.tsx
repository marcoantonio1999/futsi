import { useEffect, useRef } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { CommunicationChannel } from "./communicationScope";

type CommunicationSite = { id: number; name: string };

export function CommunicationScopePicker({
  sites,
  channels,
  selectedSite,
  selectedAddress,
  hasUnassigned,
  allowAllSites,
  disabled = false,
  inbox = false,
  onChange,
}: {
  sites: CommunicationSite[];
  channels: CommunicationChannel[];
  selectedSite: string;
  selectedAddress: string;
  hasUnassigned: boolean;
  allowAllSites: boolean;
  disabled?: boolean;
  inbox?: boolean;
  onChange: (site: string, address: string) => void;
}) {
  const pickerRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closePicker = (event: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) pickerRef.current.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closePicker);
    return () => document.removeEventListener("pointerdown", closePicker);
  }, []);

  const channelName = (channel: CommunicationChannel) => channel.channel_label || channel.business_address.replace("whatsapp:", "").replace("meta:", "ID ");
  const selectedSiteRecord = sites.find(site => String(site.id) === selectedSite);
  const selectedChannel = channels.find(channel => channel.business_address === selectedAddress);
  const selectedSiteChannels = channels.filter(channel => String(channel.site) === selectedSite);
  const siteLabel = selectedSite === "all" ? "Todas las sedes" : selectedSite === "unassigned" ? "Sin sede vinculada" : selectedSiteRecord?.name || "Sede";
  const channelLabel = selectedChannel ? channelName(selectedChannel) : selectedSiteChannels.length === 1 ? channelName(selectedSiteChannels[0]) : selectedSite === "all" || selectedSiteChannels.length > 1 ? "Todos los números" : "Sin número configurado";

  function choose(site: string, address: string) {
    pickerRef.current?.removeAttribute("open");
    if (!disabled && (site !== selectedSite || address !== selectedAddress)) onChange(site, address);
  }

  return <section className={`comm-panel comm-scope-picker-wrap ${inbox ? "comm-inbox-scope" : ""}`} aria-label="Sede y número de atención">
    <details className="comm-scope-picker" ref={pickerRef}>
      <summary aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }}><span>Sede y número</span><strong>{siteLabel}<small>{channelLabel}</small></strong><ChevronDown size={17} /></summary>
      <div className="comm-scope-picker-menu">
        {allowAllSites && <button type="button" aria-current={selectedSite === "all" ? "true" : undefined} onClick={() => choose("all", "all")}><span><strong>Todas las sedes</strong><small>Todos los números disponibles</small></span>{selectedSite === "all" && <Check size={16} />}</button>}
        {sites.map(site => {
          const siteChannels = channels.filter(channel => channel.site === site.id);
          if (siteChannels.length <= 1) {
            const channel = siteChannels[0];
            const active = selectedSite === String(site.id) && (selectedAddress === "all" || selectedAddress === channel?.business_address);
            return <button type="button" aria-current={active ? "true" : undefined} key={site.id} onClick={() => choose(String(site.id), channel?.business_address || "all")}><span><strong>{site.name}</strong><small>{channel ? channelName(channel) : "Sin número configurado"}</small></span>{active && <Check size={16} />}</button>;
          }
          return <details className="comm-scope-site-group" key={site.id} open={selectedSite === String(site.id)}><summary><span><strong>{site.name}</strong><small>{siteChannels.length} números disponibles</small></span><ChevronRight size={16} /></summary><div>
            <button type="button" aria-current={selectedSite === String(site.id) && selectedAddress === "all" ? "true" : undefined} onClick={() => choose(String(site.id), "all")}><span>Todos los números</span>{selectedSite === String(site.id) && selectedAddress === "all" && <Check size={15} />}</button>
            {siteChannels.map(channel => <button type="button" aria-current={selectedAddress === channel.business_address ? "true" : undefined} key={channel.business_address} onClick={() => choose(String(site.id), channel.business_address)}><span>{channelName(channel)}</span>{selectedAddress === channel.business_address && <Check size={15} />}</button>)}
          </div></details>;
        })}
        {hasUnassigned && <button type="button" aria-current={selectedSite === "unassigned" ? "true" : undefined} onClick={() => choose("unassigned", "all")}><span><strong>Sin sede vinculada</strong><small>Canales pendientes de asignar</small></span>{selectedSite === "unassigned" && <Check size={16} />}</button>}
      </div>
    </details>
  </section>;
}
