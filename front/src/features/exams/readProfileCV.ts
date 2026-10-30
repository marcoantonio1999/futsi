// Local extraction only. The PDF bytes are never sent to an API or storage.
export type CVText={cv_text:string;warnings:string[]};
export async function readProfileCV(file:File):Promise<CVText> {
  if(file.size>8*1024*1024)throw new Error('El CV supera 8 MB.');
  if(/\.txt$/i.test(file.name)) {
    const text=(await file.text()).replace(/\u0000/g,'').trim();
    if(!text||text.length>80000)throw new Error('El CV debe tener entre 1 y 80 000 caracteres.');
    return{cv_text:text,warnings:[]};
  }
  if(!/\.pdf$/i.test(file.name))throw new Error('Selecciona un CV en PDF digital o TXT.');
  const pdfjs=await import('pdfjs-dist');
  const {default:worker}=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc=worker;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),useSystemFonts:true});
  try {
    const pdf=await task.promise;
    if(pdf.numPages>20)throw new Error('El CV admite hasta 20 páginas.');
    const pages:string[]=[],empty:number[]=[];
    for(let n=1;n<=pdf.numPages;n++) {
      const page=await pdf.getPage(n),content=await page.getTextContent();
      let text='',previousY:number|undefined;
      for(const item of content.items) {
        if(!('str' in item))continue;
        const y=item.transform[5];
        if(previousY!==undefined&&Math.abs(previousY-y)>3)text+='\n';
        text+=item.str+(item.hasEOL?'\n':' ');previousY=y;
      }
      pages.push(text.trim());if(!text.trim())empty.push(n);
      page.cleanup();
    }
    const text=pages.join('\n\n').replace(/\u0000/g,'').trim();
    if(!text)throw new Error('PDF sin texto extraíble: puede ser un escaneo o una imagen. Requiere transcripción manual; no se utiliza OCR ni IA.');
    if(text.length>80000)throw new Error('El CV supera 80 000 caracteres de texto.');
    return{cv_text:text,warnings:empty.length?[`Las páginas ${empty.join(', ')} no contienen texto extraíble. Revisa que no falte información; no se actualizará automáticamente.`]:[]};
  }finally{await task.destroy();}
}
