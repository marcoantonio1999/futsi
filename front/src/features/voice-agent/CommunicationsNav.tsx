import { BriefcaseBusiness, Building2, CalendarDays, ChevronDown, MessageCircle, Settings2 } from "lucide-react";
import type { VoiceDashboardSection } from "./model";
import { useContext, useEffect, useState } from 'react';
import { VeronicaOnlyContext, isVeronicaSection } from './CommunicationsAccess';

type CommunicationItem = { key: VoiceDashboardSection; label: string; shortLabel?: string; admin?: boolean };

const academyBulkItems: CommunicationItem[] = [
  { key: "bulk-academy", label: "Nuevo envío", admin: true },
  { key: "bulk-academy-history", label: "Historial de envíos", shortLabel: "Historial", admin: true },
];

const courtAttentionItems: CommunicationItem[] = [
  { key: "summary", label: "Resumen" },
  { key: "whatsapp", label: "Bandeja de WhatsApp", shortLabel: "WhatsApp" },
  { key: "templates", label: "Plantillas de WhatsApp", shortLabel: "Plantillas" },
  { key: "template-builder", label: "Crear plantilla", shortLabel: "Crear plantilla" },
  ...academyBulkItems,
  { key: "calls", label: "Llamadas", admin: true },
];

const hrAttentionItems: CommunicationItem[] = [
  { key: "veronica", label: "Atención manual", shortLabel: "Atención manual", admin: true },
  { key: "veronica-filters", label: "Filtros de reclutamiento", shortLabel: "Filtros", admin: true },
  { key: "bulk-veronica", label: "Envíos masivos", shortLabel: "Masivos", admin: true },
];

const attentionAreas = [
  { key: "courts", label: "Canchas", icon: Building2, items: courtAttentionItems },
  { key: "hr", label: "RRHH", icon: BriefcaseBusiness, items: hrAttentionItems },
] as const;

export const communicationGroups: Array<{
  label: string;
  icon: typeof MessageCircle;
  items: CommunicationItem[];
}> = [
  { label: "Atención", icon: MessageCircle, items: [...courtAttentionItems, ...hrAttentionItems] },
  { label: "Agenda", icon: CalendarDays, items: [
    { key: "bookings", label: "Pruebas gratuitas" },
    { key: "availability", label: "Disponibilidad", shortLabel: "Horarios" },
  ] },
  { label: "Gestión", icon: Settings2, items: [
    { key: "connections", label: "Conexiones", admin: true },
    { key: "collections", label: "Cobranza por WhatsApp", shortLabel: "Cobranza" },
    { key: "weekly-stats", label: "Estadísticas", admin: true },
    { key: "chat-export", label: "Exportar chats", admin: true },
    { key: "settings", label: "Ajustes del asistente", shortLabel: "Ajustes" , admin: true },
  ] },
];

export function CommunicationsNav({ section, canReview, onSelect, compact = false }: {
  section: VoiceDashboardSection; canReview: boolean; onSelect: (section: VoiceDashboardSection) => void; compact?: boolean;
}) {
  const veronicaOnly = useContext(VeronicaOnlyContext);
  const activeAttentionArea = hrAttentionItems.some(item => item.key === section) ? "hr" : "courts";
  const academyBulkActive = academyBulkItems.some(item => item.key === section);
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>(() => ({
    courts: !veronicaOnly && activeAttentionArea === "courts",
    hr: veronicaOnly || activeAttentionArea === "hr",
  }));
  const [academyBulkExpanded, setAcademyBulkExpanded] = useState(academyBulkActive);
  useEffect(() => {
    setExpandedAreas(current => current[activeAttentionArea] ? current : { ...current, [activeAttentionArea]: true });
  }, [activeAttentionArea]);
  useEffect(() => { if (academyBulkActive) setAcademyBulkExpanded(true); }, [academyBulkActive]);
  const allowed = (item: CommunicationItem) => veronicaOnly ? isVeronicaSection(item.key) : !item.admin || canReview;

  return <nav aria-label={compact ? "Subsecciones de comunicaciones" : "Comunicaciones"} className={compact ? "comm-mobile-nav comm-section-map" : "comm-nav"}>
    {communicationGroups.map(group => {
      const items = group.items.filter(allowed);
      if (!items.length) return null;
      const Icon = group.icon;
      return <div className="comm-nav-group" key={group.label}>
        <p className="comm-group-title"><Icon size={14} aria-hidden="true" /><span>{group.label}</span></p>
        {group.label === "Atención" ? <div className="comm-nav-subgroups">{attentionAreas.map(area => {
          const areaItems = area.items.filter(allowed);
          if (!areaItems.length) return null;
          const AreaIcon = area.icon;
          const expanded = Boolean(expandedAreas[area.key]);
          return <section className="comm-nav-subgroup" key={area.key}>
            <button type="button" className="comm-nav-subgroup-toggle" aria-expanded={expanded} aria-controls={`communications-${compact ? "map" : "menu"}-${area.key}`} onClick={() => setExpandedAreas(current => ({ ...current, [area.key]: !expanded }))}>
              <span><AreaIcon size={13} aria-hidden="true" />{area.label}</span><ChevronDown className="comm-nav-chevron" size={14} aria-hidden="true" />
            </button>
            <ul id={`communications-${compact ? "map" : "menu"}-${area.key}`} className="comm-nav-children" aria-label={area.label} hidden={!expanded}>
              {areaItems.filter(item => !academyBulkItems.some(bulkItem => bulkItem.key === item.key)).map(item => <NavItem key={item.key} item={item} section={section} compact={compact} onSelect={onSelect} />)}
              {area.key === "courts" && academyBulkItems.some(item => areaItems.some(areaItem => areaItem.key === item.key)) && <li className="comm-nav-subgroup comm-nav-nested-subgroup">
                <button type="button" className="comm-nav-subgroup-toggle" aria-expanded={academyBulkExpanded} aria-controls={`communications-${compact ? "map" : "menu"}-academy-bulk`} onClick={() => setAcademyBulkExpanded(value => !value)}>
                  <span>Envíos masivos</span><ChevronDown className="comm-nav-chevron" size={14} aria-hidden="true" />
                </button>
                <ul id={`communications-${compact ? "map" : "menu"}-academy-bulk`} className="comm-nav-children" aria-label="Envíos masivos" hidden={!academyBulkExpanded}>
                  {academyBulkItems.filter(item => areaItems.some(areaItem => areaItem.key === item.key)).map(item => <NavItem key={item.key} item={item} section={section} compact={compact} onSelect={onSelect} />)}
                </ul>
              </li>}
            </ul>
          </section>;
        })}</div> : <ul className="comm-nav-children" aria-label={group.label}>
          {items.map(item => <li key={item.key}>
            <button
              type="button"
              data-testid={(compact ? "communications-map-" : "communications-subsection-") + item.key}
              aria-current={section === item.key ? "page" : undefined}
              aria-label={item.label}
              title={item.label}
              onClick={() => onSelect(item.key)}
            >{compact ? item.shortLabel ?? item.label : item.label}</button>
          </li>)}
        </ul>}
      </div>;
    })}
  </nav>;
}

function NavItem({ item, section, compact, onSelect }: { item: CommunicationItem; section: VoiceDashboardSection; compact: boolean; onSelect: (section: VoiceDashboardSection) => void }) {
  return <li><button
    type="button"
    data-testid={(compact ? "communications-map-" : "communications-subsection-") + item.key}
    aria-current={section === item.key ? "page" : undefined}
    aria-label={item.label}
    title={item.label}
    onClick={() => onSelect(item.key)}
  >{compact ? item.shortLabel ?? item.label : item.label}</button></li>;
}
