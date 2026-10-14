export type LightingResult = { mean: number; centerMean: number; darkFraction: number; sufficient: boolean };

// Approximate luminance (0–255), not facial recognition or document validation.
// Conservative thresholds: warn, never reject solely on this estimate.
export function calculateLighting(pixels: ArrayLike<number>, width: number, height: number): LightingResult {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) throw new Error('Imagen inválida');
  let total = 0, center = 0, centerCount = 0, dark = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3] / 255;
      const luminance = (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) * alpha + 255 * (1 - alpha);
      total += luminance;
      if (luminance < 40) dark++;
      if (x >= width * 0.25 && x < width * 0.75 && y >= height * 0.2 && y < height * 0.8) {
        center += luminance; centerCount++;
      }
    }
  }
  const count = width * height;
  const mean = total / count, centerMean = centerCount ? center / centerCount : mean, darkFraction = dark / count;
  return { mean, centerMean, darkFraction, sufficient: mean >= 55 && centerMean >= 50 && darkFraction <= 0.65 };
}

export function sampleLighting(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement): LightingResult {
  if (!width || !height) throw new Error('Imagen no disponible');
  const scale = Math.min(1, 160 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No se pudo revisar la iluminación');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return calculateLighting(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
