// Development-only navigation fixture. No API requests or sends.
import React, {useState, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {AdminShellSidebar} from '../src/components/layout/AdminShellSidebar';
import {AdminShellMobileMenu} from '../src/components/layout/AdminShellMobileMenu';
import {shellToneForScope} from '../src/components/layout/adminShellModel';
import {CourtCommunicationsOnlyContext} from '../src/features/voice-agent/CommunicationsAccess';
import '../src/styles.css';
import '../src/features/voice-agent/communications.css';
if(!import.meta.env.DEV) throw new Error('Development only');
const noop=()=>{};
function Preview(){
 const [open,setOpen]=useState(false),[expanded,setExpanded]=useState(true),[section,setSection]=useState('response-schedule');
 const ref=useRef(null);
 const select=(value:string)=>{setSection(value);setOpen(false);};
 const props={sidebarTabs:[{key:'communications',label:'Comunicaciones',icon:<span>C</span>}],effectiveActiveTab:'communications',billingSection:'scheduled',communicationsSection:section,communicationsMenuExpanded:false,onToggleCommunicationsMenu:()=>setExpanded(true),coachesSection:'overview',coachesMenuExpanded:false,canManageCoaches:false,onToggleCoachesMenu:noop,onSelectCoachesSection:noop,guardiansSection:'overview',guardiansMenuExpanded:false,onToggleGuardiansMenu:noop,onSelectGuardiansSection:noop,studentsSection:'overview',tournamentsMenuExpanded:false,onToggleTournamentsMenu:noop,studentsMenuExpanded:false,onToggleStudentsMenu:noop,canReviewCommunicationCalls:false,canProgramBilling:false,showBillingSubsections:false,tournamentSection:'overview',shellTone:shellToneForScope('academy'),onSelectTab:noop,onSelectBillingSection:noop,onSelectCommunicationsSection:select,onSelectStudentsSection:noop,onSelectTournamentSection:noop};
 return <CourtCommunicationsOnlyContext.Provider value={true}>
  <AdminShellSidebar {...props as any} sidebarRef={ref} sidebarExpanded={expanded} businessScope="academy" onToggleExpanded={()=>setExpanded(!expanded)}/>
  <button className="lg:hidden" style={{minWidth:44,minHeight:44}} onClick={()=>setOpen(true)}>Abrir menú</button>
  <AdminShellMobileMenu {...props as any} isOpen={open} onClose={()=>setOpen(false)} onLogout={noop}/>
  <main className="lg:ml-72"><h1>Prueba de navegación</h1><output>{section}</output></main>
 </CourtCommunicationsOnlyContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
