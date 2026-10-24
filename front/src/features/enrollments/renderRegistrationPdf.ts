// Render private attachments locally. No upload, public URL or download link.
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export async function renderRegistrationPdf(blob: Blob, signal: AbortSignal): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const abort = () => { void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Carga cancelada');
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw new Error('El documento supera 20 páginas.');
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      if (signal.aborted) throw new Error('Carga cancelada');
      const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width, 2000 / base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      pages.push(canvas.toDataURL('image/jpeg', .94));
      canvas.width = 0; canvas.height = 0; page.cleanup();
    }
    return pages;
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}
