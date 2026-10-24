export type PresentationData = { player_name: string; reason: string; date: string };

// Wrap by measured pixels, including names/words without spaces; never omit text.
export function wrapPresentationText(context: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (line && context.measureText(line + character).width > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function disciplinaryImage(data: PresentationData, photo: HTMLImageElement | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw new Error('Este navegador no permite generar la imagen.');
  const width = 1000, padding = 80, textWidth = width - padding * 2;
  canvas.width = width;
  context.font = 'bold 46px Arial';
  const names = wrapPresentationText(context, data.player_name, textWidth);
  context.font = '34px Arial';
  const reasons = wrapPresentationText(context, data.reason, textWidth);
  const dates = wrapPresentationText(context, data.date, textWidth);
  canvas.height = 80 + 420 + 55 + names.length * 58 + 45 + 40 + reasons.length * 46 + 45 + 40 + dates.length * 46 + 80;
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, canvas.height);
  const photoX = 320, photoY = 80, photoWidth = 360, photoHeight = 420;
  context.fillStyle = '#f1f4f2'; context.fillRect(photoX, photoY, photoWidth, photoHeight);
  if (photo) {
    const scale = Math.min(photoWidth / photo.naturalWidth, photoHeight / photo.naturalHeight);
    const w = photo.naturalWidth * scale, h = photo.naturalHeight * scale;
    context.drawImage(photo, photoX + (photoWidth - w) / 2, photoY + (photoHeight - h) / 2, w, h);
  } else {
    // Neutral placeholder, never a replacement photograph of another person.
    context.fillStyle = '#a7b3ac'; context.beginPath(); context.arc(500, 230, 65, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.ellipse(500, 410, 115, 100, 0, Math.PI, Math.PI * 2); context.fill();
  }
  let y = 555;
  context.fillStyle = '#172d23'; context.textBaseline = 'top'; context.font = 'bold 46px Arial';
  for (const line of names) { context.fillText(line, padding, y); y += 58; }
  y += 45; context.font = 'bold 30px Arial'; context.fillText('Motivo', padding, y); y += 40;
  context.font = '34px Arial';
  for (const line of reasons) { context.fillText(line, padding, y); y += 46; }
  y += 45; context.font = 'bold 30px Arial'; context.fillText('Fecha', padding, y); y += 40;
  context.font = '34px Arial';
  for (const line of dates) { context.fillText(line, padding, y); y += 46; }
  return canvas;
}
