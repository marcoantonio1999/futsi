export const PHOTO_MAX_BYTES = 3_000_000;

/** Compress only oversized photos, locally; no upload or third-party service. */
export async function compressEnrollmentPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= PHOTO_MAX_BYTES) return file;
  let source: ImageBitmap | HTMLImageElement;
  let sourceUrl = "";
  try {
    if (typeof createImageBitmap === "function") source = await createImageBitmap(file, { imageOrientation: "from-image" });
    else {
      sourceUrl = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("No se pudo leer la foto.")); image.src = sourceUrl; });
      source = image;
    }
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo comprimir la foto en este navegador.");
      const width = "naturalWidth" in source ? source.naturalWidth : source.width;
      const height = "naturalHeight" in source ? source.naturalHeight : source.height;
      if (!width || !height) throw new Error("La foto no tiene dimensiones válidas.");
      let scale = Math.min(1, 4096 / Math.max(width, height));
      for (let attempt = 0; attempt < 8; attempt++, scale *= 0.8) {
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.92, 0.85, 0.78, 0.7]) {
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("No se pudo comprimir la foto.")), "image/jpeg", quality));
          if (blob.size <= PHOTO_MAX_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
        }
      }
      throw new Error("No se pudo reducir la foto a 3 MB. Elige otra imagen.");
    } finally { if ("close" in source) source.close(); }
  } finally { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }
}
