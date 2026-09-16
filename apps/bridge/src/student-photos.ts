import { access, mkdir, readFile, unlink, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./vault";

const PHOTO_DIR =
  process.env.PONT_PHOTO_DIR ??
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "pont", "photos")
    : path.join(DATA_DIR, "photos"));

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_BYTES = 6 * 1024 * 1024;

export type StoredPhoto = {
  studentId: string;
  mime: string;
  bytes: number;
  updatedAt: string;
};

function safeId(studentId: string) {
  return studentId.replace(/[^\w.-]+/g, "_").slice(0, 64) || "unknown";
}

function extForMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  return "jpg";
}

async function ensureDir() {
  await mkdir(PHOTO_DIR, { recursive: true });
}

function metaPath(studentId: string) {
  return path.join(PHOTO_DIR, `${safeId(studentId)}.json`);
}

function guessBinaryPath(studentId: string, mime?: string) {
  const base = path.join(PHOTO_DIR, safeId(studentId));
  if (mime) return `${base}.${extForMime(mime)}`;
  return base;
}

export async function listPhotoStudentIds(): Promise<string[]> {
  try {
    await ensureDir();
    const files = await readdir(PHOTO_DIR);
    const ids = new Set<string>();
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const meta = JSON.parse(await readFile(path.join(PHOTO_DIR, f), "utf8")) as StoredPhoto;
          if (meta.studentId) ids.add(meta.studentId);
        } catch {
          // ignore
        }
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

export async function hasStudentPhoto(studentId: string) {
  try {
    await access(metaPath(studentId));
    return true;
  } catch {
    return false;
  }
}

export async function saveStudentPhoto(input: {
  studentId: string;
  buffer: Buffer;
  mime: string;
}): Promise<StoredPhoto> {
  const mime = (input.mime || "image/jpeg").toLowerCase().split(";")[0]!.trim();
  if (!ALLOWED.has(mime)) {
    throw new Error("Format no suportat. Usa JPG, PNG o WEBP.");
  }
  if (input.buffer.length < 32) throw new Error("Imatge buida.");
  if (input.buffer.length > MAX_BYTES) throw new Error("Imatge massa gran (màx. 6 MB).");
  await ensureDir();
  await deleteStudentPhoto(input.studentId).catch(() => undefined);
  const disk = guessBinaryPath(input.studentId, mime);
  const meta: StoredPhoto = {
    studentId: input.studentId,
    mime,
    bytes: input.buffer.length,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(disk, input.buffer, { mode: 0o600 });
  await writeFile(metaPath(input.studentId), JSON.stringify(meta), { mode: 0o600 });
  return meta;
}

export async function readStudentPhoto(studentId: string): Promise<{
  buffer: Buffer;
  mime: string;
  meta: StoredPhoto;
} | null> {
  try {
    const raw = await readFile(metaPath(studentId), "utf8");
    const meta = JSON.parse(raw) as StoredPhoto;
    const disk = guessBinaryPath(studentId, meta.mime);
    const buffer = await readFile(disk);
    return { buffer, mime: meta.mime || "image/jpeg", meta };
  } catch {
    return null;
  }
}

export async function deleteStudentPhoto(studentId: string) {
  const id = safeId(studentId);
  try {
    const files = await readdir(PHOTO_DIR);
    await Promise.all(
      files
        .filter((f) => f === `${id}.json` || f.startsWith(`${id}.`))
        .map((f) => unlink(path.join(PHOTO_DIR, f)).catch(() => undefined)),
    );
  } catch {
    // ignore
  }
}

export function photoPublicUrl(studentId: string) {
  return `/api/students/${encodeURIComponent(studentId)}/photo`;
}
