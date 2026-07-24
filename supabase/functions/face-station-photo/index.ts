import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type DeviceRow = {
  public_id: string;
  site_id: number;
  secret_hash: string;
  service_user_id: number;
};

const encoder = new TextEncoder();

function jsonError(detail: string, status: number): Response {
  return Response.json({ detail }, { status });
}

function bytesFromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifyDjangoPassword(secret: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, salt, digestText] = encoded.split("$", 4);
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2_sha256" || !Number.isSafeInteger(iterations) || iterations < 1) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations },
    key,
    256,
  );
  return constantTimeEqual(new Uint8Array(derived), bytesFromBase64(digestText));
}

function adminKey(): string {
  const configured = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (configured) {
    const keys = JSON.parse(configured) as Record<string, string>;
    if (keys.default) return keys.default;
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

async function authorizedDevice(admin: ReturnType<typeof createClient>, token: string): Promise<DeviceRow | null> {
  const [prefix, publicId, ...secretParts] = token.split(":");
  const secret = secretParts.join(":");
  if (prefix !== "futsi_station" || !publicId || !secret) return null;

  const { data: device, error } = await admin
    .from("face_station_devices")
    .select("public_id,site_id,secret_hash,service_user_id")
    .eq("public_id", publicId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !device || !(await verifyDjangoPassword(secret, device.secret_hash))) return null;

  const { data: serviceUser } = await admin
    .from("core_user")
    .select("is_active")
    .eq("id", device.service_user_id)
    .maybeSingle();
  return serviceUser?.is_active ? device as DeviceRow : null;
}

async function uploadReference(
  admin: ReturnType<typeof createClient>,
  device: DeviceRow,
  body: Record<string, unknown>,
): Promise<Response> {
  const personType = String(body.person_type ?? "");
  if (!new Set(["student", "collaborator"]).has(personType)) {
    return jsonError("Tipo de persona no permitido.", 400);
  }
  const localSubjectId = String(body.local_subject_id ?? "").trim();
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(localSubjectId)) {
    return jsonError("Identificador local invalido.", 400);
  }
  const encodedImage = String(body.image_base64 ?? "");
  if (!encodedImage) return jsonError("Falta el recorte facial.", 400);

  let image: Uint8Array;
  try {
    image = bytesFromBase64(encodedImage);
  } catch {
    return jsonError("El recorte facial no contiene base64 valido.", 400);
  }
  if (!image.length || image.length > 3 * 1024 * 1024) {
    return jsonError("El recorte facial excede el limite permitido.", 400);
  }

  const bucket = personType === "student"
    ? "student-private-photos"
    : "adult-private-photos";
  const folder = personType === "student" ? "students" : "collaborators";
  const objectPath = `${folder}/${device.site_id}/face-station/${device.public_id}/${localSubjectId}.jpg`;
  const { error } = await admin.storage.from(bucket).upload(
    objectPath,
    image,
    { contentType: "image/jpeg", upsert: true },
  );
  if (error) return jsonError(`No se pudo guardar la referencia: ${error.message}`, 502);
  return Response.json({ photo_uri: `supabase://${bucket}/${objectPath}` });
}

async function personPhotoUri(
  admin: ReturnType<typeof createClient>,
  device: DeviceRow,
  personType: string,
  personId: number,
): Promise<string> {
  if (personType === "student") {
    const { data } = await admin
      .from("students")
      .select("site_id,status,photo_url")
      .eq("id", personId)
      .maybeSingle();
    const activeStatuses = new Set(["trial", "active", "paused", "injured"]);
    return data?.site_id === device.site_id && activeStatuses.has(data.status) ? data.photo_url ?? "" : "";
  }
  if (personType === "player") {
    const { data: player } = await admin
      .from("players")
      .select("team_id,is_active,photo_url")
      .eq("id", personId)
      .maybeSingle();
    if (!player?.is_active || !player.team_id) return "";
    const { data: team } = await admin
      .from("teams")
      .select("tournament_id")
      .eq("id", player.team_id)
      .maybeSingle();
    if (!team?.tournament_id) return "";
    const { data: tournament } = await admin
      .from("tournaments")
      .select("site_id")
      .eq("id", team.tournament_id)
      .maybeSingle();
    return tournament?.site_id === device.site_id ? player.photo_url ?? "" : "";
  }
  if (personType === "collaborator") {
    const { data } = await admin
      .from("core_user")
      .select("primary_site_id,role,is_active,avatar_url")
      .eq("id", personId)
      .maybeSingle();
    const collaboratorRoles = new Set([
      "admin",
      "dev",
      "accounting",
      "owner",
      "site_coordinator",
      "cashier",
      "coach",
      "collaborator",
    ]);
    return (
      data?.is_active
      && data.primary_site_id === device.site_id
      && personId !== device.service_user_id
      && collaboratorRoles.has(data.role)
    ) ? data.avatar_url ?? "" : "";
  }
  return "";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonError("Metodo no permitido.", 405);
  const key = adminKey();
  const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!key || !projectUrl) return jsonError("Servicio no configurado.", 503);

  try {
    const admin = createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = request.headers.get("X-Futsi-Station-Key")?.trim() ?? "";
    const device = await authorizedDevice(admin, token);
    if (!device) return jsonError("Estacion no autorizada.", 401);

    const body = await request.json() as Record<string, unknown>;
    if (body.action === "upload_reference") {
      return await uploadReference(admin, device, body);
    }
    const personType = String(body.person_type ?? "");
    const personId = Number(body.person_id);
    if (!Number.isSafeInteger(personId) || personId < 1) return jsonError("Persona invalida.", 400);

    const photoUri = await personPhotoUri(admin, device, personType, personId);
    const match = /^supabase:\/\/([^/]+)\/(.+)$/.exec(photoUri);
    if (!match) return jsonError("La persona no tiene foto de referencia.", 404);
    const [, bucket, objectPath] = match;
    const expectedBucket = personType === "student" ? "student-private-photos" : "adult-private-photos";
    if (bucket !== expectedBucket) return jsonError("Referencia fuera del bucket permitido.", 403);

    const { data: image, error } = await admin.storage.from(bucket).download(objectPath);
    if (error || !image) return jsonError("No se pudo descargar la referencia.", 404);
    return new Response(image, {
      headers: {
        "Content-Type": image.type || "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError("No se pudo preparar la referencia.", 400);
  }
});
