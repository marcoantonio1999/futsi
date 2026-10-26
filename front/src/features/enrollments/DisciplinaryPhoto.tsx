import {useEffect,useRef,useState} from 'react';
import {UserRound} from 'lucide-react';
import {API_URL} from '../../api';
import {fetchEnrollmentDocument} from './fetchEnrollmentDocument';

export function DisciplinaryPhoto({token,endpoint,playerName,hasPhoto,large=false}:{token:string;endpoint:string;playerName:string;hasPhoto?:boolean;large?:boolean}){
  const host=useRef<HTMLSpanElement>(null);
  const [url,setUrl]=useState(''),[failed,setFailed]=useState(false);
  useEffect(()=>{
    setUrl('');setFailed(false);
    if(!hasPhoto)return;
    let active=true,started=false,objectUrl='';const controller=new AbortController();
    const load=()=>{
      if(started)return;started=true;
      fetchEnrollmentDocument(endpoint,token,controller.signal).then(async response=>{
        if(!response.ok||!response.headers.get('Content-Type')?.startsWith('image/'))throw new Error('Foto no disponible');
        objectUrl=URL.createObjectURL(await response.blob());if(active)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);
      }).catch(()=>{if(active)setFailed(true)});
    };
    const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();load()}},{rootMargin:'100px'});
    if(observer&&host.current)observer.observe(host.current);else load();
    return()=>{active=false;controller.abort();observer?.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[token,endpoint,hasPhoto]);
  const label=failed?'Foto no disponible':hasPhoto?'Cargando foto':'Sin foto';
  return <span ref={host} className={`disciplinary-photo${large?' is-large':''}`}>
    {url&&!failed?<img src={url} alt={`Foto de ${playerName}`} width={large?128:48} height={large?128:56} onError={()=>setFailed(true)}/>:<span role="img" aria-label={label}><UserRound size={large?40:22} aria-hidden="true"/><small>{label}</small></span>}
  </span>;
}
