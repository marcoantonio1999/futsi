import {useEffect, useId, useRef, useState} from 'react';
import {Popover} from '@base-ui/react/popover';
import {ArrowLeft, ChevronRight, X, type LucideIcon} from 'lucide-react';
import type {VoiceDashboardSection} from './model';

type Item = {key:VoiceDashboardSection;label:string};
type Group = {key:string;label:string;icon:LucideIcon;items:Item[]};
const auditKeys = new Set(['summary','chat-quality','weekly-stats']);

export function CommunicationsFlyout({groups,section,onSelect}:{groups:Group[];section:VoiceDashboardSection;onSelect:(section:VoiceDashboardSection)=>void}) {
 const [open,setOpen]=useState<string|null>(null);
 const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:1023px)').matches);
 const panel=useRef<HTMLElement|null>(null),id=useId();
 const triggers=useRef<Record<string,HTMLButtonElement|null>>({});
 const previous=useRef<string|null>(null);
 useEffect(()=>{setOpen(null);},[section]);
 useEffect(()=>{
  const query=window.matchMedia('(max-width:1023px)');
  const change=()=>{setMobile(query.matches);setOpen(null);};
  query.addEventListener('change',change);
  return ()=>query.removeEventListener('change',change);
 },[]);
 useEffect(()=>{
  if(mobile && open) panel.current?.querySelector('button')?.focus();
  else if(mobile && previous.current) triggers.current[previous.current]?.focus();
  previous.current=open;
 },[mobile,open]);
 function select(key:VoiceDashboardSection){setOpen(null);onSelect(key);}
 function links(group:Group){
  const main=group.items.filter(item=>!auditKeys.has(item.key));
  const audits=group.items.filter(item=>auditKeys.has(item.key));
  const button=(item:Item)=><button key={item.key} type="button" aria-current={section===item.key?'page':undefined} onClick={()=>select(item.key)}>{item.label}</button>;
  return <div className="comm-flyout-links">{main.map(button)}{audits.length>0 && <><p className="comm-flyout-label">Auditoría de WhatsApp</p>{audits.map(button)}</>}</div>;
 }
 const selected=groups.find(group=>group.key===open);
 if(mobile && selected) return <section ref={panel} className="comm-flyout-mobile" aria-label={`Opciones de ${selected.label}`}>
  <button type="button" className="comm-flyout-back" onClick={()=>setOpen(null)}><ArrowLeft size={18} aria-hidden="true"/>Volver al menú</button>
  <h3>{selected.label}</h3>{links(selected)}
 </section>;
 return <nav className="comm-flyout-nav" aria-label="Áreas de Soccer WA">{groups.map(group=>{
  const Icon=group.icon,active=group.items.some(item=>item.key===section);
  const contents=<><Icon size={19} aria-hidden="true"/><span>{group.label}</span><ChevronRight size={16} aria-hidden="true"/></>;
  if(mobile) return <button ref={element=>{triggers.current[group.key]=element;}} key={group.key} type="button" className="comm-flyout-trigger" aria-expanded={false} data-active={active || undefined} onClick={()=>setOpen(group.key)}>{contents}</button>;
  return <Popover.Root key={group.key} open={open===group.key} onOpenChange={value=>setOpen(current=>value?group.key:current===group.key?null:current)}>
   <Popover.Trigger type="button" className="comm-flyout-trigger" data-active={active || undefined}>{contents}</Popover.Trigger>
   <Popover.Portal><Popover.Positioner side="right" align="start" sideOffset={12} collisionPadding={12} className="comm-flyout-positioner">
    <Popover.Popup className="comm-flyout-popup" aria-labelledby={`${id}-${group.key}`}>
     <header><Popover.Title id={`${id}-${group.key}`}>{group.label}</Popover.Title><Popover.Close type="button" aria-label="Cerrar submenú"><X size={18}/></Popover.Close></header>
     {links(group)}
    </Popover.Popup>
   </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
 })}</nav>;
}
