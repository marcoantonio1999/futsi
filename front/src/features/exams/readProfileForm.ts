// Read locally only: binary files never leave this browser or enter storage.
export type FormText = { form_text: string; form_fields: Record<string,string> };

export async function readProfileForm(file: File): Promise<FormText> {
  if (file.size > 8 * 1024 * 1024) throw new Error('El archivo supera 8 MB.');
  if (/\.txt$/i.test(file.name)) {
    const text = await file.text();
    if (!text.trim() || text.length > 60000) throw new Error('El texto debe tener entre 1 y 60 000 caracteres.');
    const fields: Record<string,string> = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([^:]{1,100}):\s*(.{1,2000})$/);
      if (match && Object.keys(fields).length < 120) fields[match[1].trim()] = match[2].trim();
    }
    return { form_text: text, form_fields: fields };
  }
  if (!/\.pdf$/i.test(file.name)) throw new Error('Selecciona un formato PDF digital o un TXT.');
  const pdfjs = await import('pdfjs-dist');
  const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 10) throw new Error('El formato admite hasta 10 páginas.');
    const fields: Record<string,string> = {};
    const fieldObjects = await pdf.getFieldObjects();
    for (const [key, objects] of fieldObjects || []) {
      const values = objects as { value?: unknown }[];
      const value = values.find(o => typeof o.value === 'string' && o.value.trim())?.value;
      if (typeof value === 'string' && value.trim()) fields[key] = value.trim();
    }
    if (fieldObjects?.size && !Object.keys(fields).length) throw new Error('El formato tiene campos digitales, pero están vacíos. Selecciona el archivo llenado y guardado, no la plantilla en blanco.');
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let line = '', previousY: number | undefined;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (previousY !== undefined && Math.abs(previousY-y) > 3) line += '\n';
        line += item.str + (item.hasEOL ? '\n' : ' '); previousY = y;
      }
      pages.push(line);
    }
    const structured = Object.entries(fields).map(([k,v]) => `${k}: ${v}`).join('\n');
    // Prefer actual filled values, not the blank template's headings/options.
    // Otherwise every template would appear to contain "Licenciatura", etc.
    const body = (structured || pages.join('\n\n')).trim();
    if (!body) throw new Error('No hay texto legible. Un escaneo o foto requiere transcribir el texto; no se procesa con OCR ni IA.');
    if (body.length > 60000 || Object.keys(fields).length > 120 || Object.entries(fields).some(([k,v]) => k.length > 100 || v.length > 2000)) throw new Error('El contenido extraído supera los límites del formato.');
    return { form_text:body, form_fields:fields };
  } finally { await task.destroy(); }
}
