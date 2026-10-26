import {API_URL} from '../../api';

async function prepare(file: Blob, kind: string): Promise<Blob> {
  if (kind.includes('signature') || file.type === 'application/pdf') return file;
  const image = await createImageBitmap(file, {imageOrientation: 'from-image'});
  try {
    const selfie = kind === 'player_photo';
    if (selfie && Math.min(image.width, image.height) < 1000) throw new Error('Usa una selfie de al menos 1000 × 1000 píxeles. Toma otra foto con mayor resolución; no amplíes una pequeña.');
    const scale = Math.min(1, (selfie ? 2400 : 2000) / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar la imagen.');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo preparar la imagen.')), 'image/jpeg', selfie ? .9 : .85));
    if (selfie && (Math.min(canvas.width, canvas.height) < 1000 || blob.size > 3_000_000)) throw new Error('Elige una selfie nítida de al menos 1000 × 1000 píxeles y hasta 3 MB.');
    return blob;
  } finally { image.close(); }
}

/** One explicit upload attempt. No retries, polling, file proxy, or API token sent to R2. */
export async function enrollmentDirectUpload(endpoint: string, files: Record<string, Blob>, form: FormData): Promise<Response> {
  const prepared = await Promise.all(Object.entries(files).map(async ([kind, file]) => {
    const content = await prepare(file, kind);
    const digest = await crypto.subtle.digest('SHA-256', await content.arrayBuffer());
    return {kind, content, size: content.size, mime: content.type, sha256: Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('')};
  }));
  const response = await fetch(API_URL + endpoint + 'uploads/', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({files: prepared.map(({content: _, ...metadata}) => metadata)}), signal: AbortSignal.timeout(30000)});
  const plan = await response.json();
  if (!response.ok) throw new Error(plan.detail || 'No se pudo autorizar la carga privada.');
  const receipts: string[] = [];
  for (const file of prepared) {
    const target = plan.files?.find((item: {kind: string}) => item.kind === file.kind);
    if (!target || !new URL(target.url).hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('Destino de carga no válido.');
    const uploaded = await fetch(target.url, {method: 'PUT', headers: target.headers, body: file.content, credentials: 'omit',
      referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(180000)});
    if (!uploaded.ok) throw new Error('No se pudo cargar un archivo. Tus datos siguen en el formulario; vuelve a intentar cuando tengas conexión.');
    receipts.push(target.receipt);
  }
  const payload: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key).filter((value): value is string => typeof value === 'string');
    if (values.length) payload[key] = values.length > 1 || key === 'enrollment_ids' || key === 'document_checklist' ? values : values[0];
  }
  return fetch(API_URL + endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...payload, uploaded_documents: receipts}), signal: AbortSignal.timeout(180000)});
}
