import { CalendarDays, MessageCircle, Settings2 } from "lucide-react";
import type { VoiceDashboardSection } from "./model";
import { useContext } from 'react';
import { VeronicaOnlyContext, isVeronicaSection } from './CommunicationsAccess';

export const communicationGroups: Array<{
  label: string;
  icon: typeof MessageCircle;
  items: Array<{ key: VoiceDashboardSection; label: string; shortLabel?: string; admin?: boolean }>;
}> = [
  { label: "Atención", icon: MessageCircle, items: [
    { key: "summary", label: "Resumen" },
    { key: "whatsapp", label: "Bandeja de WhatsApp", shortLabel: "WhatsApp" },
    { key: "templates", label: "Plantillas de WhatsApp", shortLabel: "Plantillas" },
    { key: "veronica", label: "Verónica · atención manual", shortLabel: "Verónica", admin: true },
    { key: "bulk-veronica", label: "Verónica · envíos masivos", shortLabel: "Masivos Vero", admin: true },
    { key: "bulk-academy", label: "Canchas · envíos masivos", shortLabel: "Masivos canchas", admin: true },
    { key: "calls", label: "Llamadas", admin: true },
  ] },
  { label: "Agenda", icon: CalendarDays, items: [
    { key: "bookings", label: "Pruebas gratuitas" },
    { key: "availability", label: "Disponibilidad", shortLabel: "Horarios" },
  ] },
  { label: "Gestión", icon: Settings2, items: [
    { key: "collections", label: "Cobranza por WhatsApp", shortLabel: "Cobranza" },
    { key: "weekly-stats", label: "Resultados", admin: true },
    { key: "settings", label: "Ajustes del asistente", shortLabel: "Ajustes" , admin: true },
  ] },
];

export function CommunicationsNav({ section, canReview, onSelect, compact = false }: {
  section: VoiceDashboardSection; canReview: boolean; onSelect: (section: VoiceDashboardSection) => void; compact?: boolean;
}) {
  const veronicaOnly = useContext(VeronicaOnlyContext);
  return <nav aria-label={compact ? "Subsecciones de comunicaciones" : "Comunicaciones"} className={compact ? "comm-mobile-nav comm-section-map" : "comm-nav"}>
    {communicationGroups.map(group => {
      const items = group.items.filter(item => veronicaOnly ? isVeronicaSection(item.key) : !item.admin || canReview);
      if (!items.length) return null;
      const Icon = group.icon;
      return <div className="comm-nav-group" key={group.label}>
        <p className="comm-group-title"><Icon size={14} aria-hidden="true" /><span>{group.label}</span></p>
        <ul className="comm-nav-children" aria-label={group.label}>
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
        </ul>
      </div>;
    })}
  </nav>;
}
