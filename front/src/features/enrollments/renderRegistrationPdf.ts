// Render private attachments locally. No upload, public URL or download link.
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export async function openRegistrationPdf(blob: Blob, signal: AbortSignal) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  let closing: Promise<void> | undefined;
  const close = () => {
    signal.removeEventListener('abort', abort);
    return closing ??= task.destroy();
  };
  const abort = () => { void close().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Carga cancelada');
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw new Error('El documento supera 20 páginas.');
    async function render(number: number, asBlob: true): Promise<Blob>;
    async function render(number: number, asBlob?: false): Promise<string>;
    async function render(number: number, asBlob = false) {
      if (signal.aborted) throw new Error('Carga cancelada');
      const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width, 2000 / base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, viewport }).promise;
        if (!asBlob) return canvas.toDataURL('image/jpeg', .94);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
          image => image ? resolve(image) : reject(new Error('No se pudo mostrar la página.')), 'image/jpeg', .94,
        ));
      } finally {
        canvas.width = 0; canvas.height = 0; page.cleanup();
      }
    }
    return { count: pdf.numPages, render, close };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

export async function renderRegistrationPdf(blob: Blob, signal: AbortSignal, limit = 20): Promise<string[]> {
  const pdf = await openRegistrationPdf(blob, signal);
  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(pdf.count, limit); number++) {
      pages.push(await pdf.render(number));
    }
    return pages;
  } finally {
    await pdf.close();
  }
}
