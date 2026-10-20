import { useEffect } from 'react';
import logo from './assets/examenes-bpower-logo.png';
import './ExamBrand.css';

export { logo as examLogo };
export function useExamBranding() {
  useEffect(() => {
    const originalTitle = document.title;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const originalIcon = icon?.getAttribute('href');
    document.title = 'Exámenes BPower';
    if (icon) icon.href = logo;
    return () => { document.title = originalTitle; if (icon && originalIcon) icon.setAttribute('href', originalIcon); };
  }, []);
}

export function ExamBrand({ publicView = false }: { publicView?: boolean }) {
  const content = <><img src={logo} alt="" width={52} height={52} /><div>{publicView ? 'Evaluaciones' : 'Exámenes'}<strong>BPower</strong></div></>;
  return publicView ? <div className="exam-brand">{content}</div> : <a className="exam-brand" href="#/examenes" aria-label="Exámenes BPower, inicio">{content}</a>;
}
