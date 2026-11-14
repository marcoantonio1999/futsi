type Field = {key:string;label:string};
type Section = {title:string;fields?:Field[];groups?:{title:string;fields:Field[]}[]};
type Application = {name:string;submitted_at:string;receipt:string;fields?:Record<string,string>};

// Build the document with DOM nodes so applicant text is never interpreted as HTML.
export function printEmploymentApplication(application:Application,sections:Section[],logo:string) {
  const view=window.open('','_blank');
  if(!view) throw new Error('Permite las ventanas emergentes para imprimir la solicitud.');
  const doc=view.document;
  doc.title='Solicitud de empleo';
  const style=doc.createElement('style');
  style.textContent=`@page{size:letter;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172b20;margin:0;font-size:9pt;line-height:1.25}header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #006c2e;padding-bottom:7px;margin-bottom:8px}header img{width:90px;height:auto}h1{font-size:17pt;margin:0}header p{margin:3px 0;font-size:9pt}h2{font-size:11pt;color:#006c2e;border-bottom:1px solid #a9c5af;margin:10px 0 4px;break-after:avoid}h3{font-size:9pt;margin:6px 0 3px;color:#264632;break-after:avoid}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 12px}.field{padding:2px 0;border-bottom:1px solid #e2ebe3;overflow-wrap:anywhere;white-space:pre-wrap;break-inside:avoid}.label{font-weight:bold}.empty{color:#68766c}footer{border-top:1px solid #a9c5af;margin-top:9px;padding-top:5px;color:#315640;font-size:8pt}@media print{header,h2,h3,footer{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  doc.head.appendChild(style);
  const header=doc.createElement('header'),img=doc.createElement('img'),heading=doc.createElement('div');
  img.src=new URL(logo,window.location.href).href; img.alt='BPower Academy';
  const title=doc.createElement('h1');title.textContent='Solicitud de empleo';heading.appendChild(title);
  const meta=doc.createElement('p');meta.textContent=`${application.name} · ${new Date(application.submitted_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})} · Folio: ${application.receipt}`;heading.appendChild(meta);
  header.append(img,heading);doc.body.appendChild(header);
  const addFields=(fields:Field[])=>{const grid=doc.createElement('div');grid.className='fields';for(const field of fields){const item=doc.createElement('div'),label=doc.createElement('span'),value=doc.createElement('span');item.className='field';label.className='label';label.textContent=field.label+': ';const text=application.fields?.[field.key];value.textContent=text?.trim()?text:'Sin proporcionar';if(!text?.trim())value.className='empty';item.append(label,value);grid.appendChild(item);}doc.body.appendChild(grid);};
  for(const section of sections){const heading=doc.createElement('h2');heading.textContent=section.title;doc.body.appendChild(heading);if(section.fields)addFields(section.fields);for(const group of section.groups||[]){const sub=doc.createElement('h3');sub.textContent=group.title;doc.body.appendChild(sub);addFields(group.fields);}}
  const footer=doc.createElement('footer');footer.textContent='BPOWER ACADEMY · Solicitud de empleo';doc.body.appendChild(footer);
  const ready=img.decode?img.decode().catch(()=>undefined):Promise.resolve();
  void ready.then(()=>{view.focus();view.print();});
}
