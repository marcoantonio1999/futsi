import { detectIdentityBounds } from './identityEdges';

// Only crop scans that look like a white page. Photos and uncertain detections
// stay intact, so the OCR can still see the entire identification.
export async function autoCropIdentity(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  let image: ImageBitmap | undefined;
  try {
    image = await createImageBitmap(file, {imageOrientation: 'from-image'});
    const scale = Math.min(1, 800 / Math.max(image.width, image.height));
    const sample = document.createElement('canvas');
    sample.width = Math.max(1, Math.round(image.width * scale));
    sample.height = Math.max(1, Math.round(image.height * scale));
    const context = sample.getContext('2d', {willReadFrequently: true});
    if (!context) return file;
    context.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height);
    let white = 0, total = 0;
    for (let y = 0; y < sample.height; y += 4) for (let x = 0; x < sample.width; x += 4) {
      if (x > sample.width * .04 && x < sample.width * .96 && y > sample.height * .04 && y < sample.height * .96) continue;
      const i = (y * sample.width + x) * 4;
      if (pixels.data[i] > 210 && pixels.data[i+1] > 210 && pixels.data[i+2] > 210) white++;
      total++;
    }
    if (!total || white / total < .75) return file;
    const box = detectIdentityBounds(pixels);
    if (box.left === 0 && box.top === 0 && box.right === 100 && box.bottom === 100) return file;
    const x = Math.floor(image.width * box.left / 100), y = Math.floor(image.height * box.top / 100);
    const width = Math.min(image.width - x, Math.ceil(image.width * box.right / 100) - x);
    const height = Math.min(image.height - y, Math.ceil(image.height * box.bottom / 100) - y);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const target = canvas.getContext('2d'); if (!target) return file;
    target.drawImage(image, x, y, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .96));
    return blob ? new File([blob], 'ine-recortada.jpg', {type: 'image/jpeg'}) : file;
  } catch { return file; }
  finally { image?.close(); }
}
