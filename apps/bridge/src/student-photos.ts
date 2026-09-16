import { access, mkdir, readFile, unlink, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { DATA_DIR } from "./vault";

const PHOTO_DIR =
  process.env.PONT_PHOTO_DIR ??
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "pont", "photos")
    : path.join(DATA_DIR, "photos"));

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_BYTES = 6 * 1024 * 1024;

export type StoredPhoto = {
  studentId: string;
  mime: string;
  bytes: number;
  updatedAt: string;
};

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
    })
  : null;

let pgReady: Promise<void> | null = null;

function ensurePg() {
  if (!pool) return null;
  if (!pgReady) {
    pgReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS pont_student_photos (
          student_id TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          data BYTEA NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        pgReady = null;
        throw err;
      });
  }
  return pgReady;
}

function safeId(studentId: string) {
  return studentId.replace(/[^\w.-]+/g, "_").slice(0, 64) || "unknown";
}

function extForMime(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic") || mime.includes("heif")) return "heic";
  return "jpg";
}

function normalizeMime(mime: string) {
  const m = (mime || "image/jpeg").toLowerCase().split(";")[0]!.trim();
  if (m === "image/jpg") return "image/jpeg";
  return m || "image/jpeg";
}

async function ensureDir() {
  await mkdir(PHOTO_DIR, { recursive: true });
}

function metaPath(studentId: string) {
  return path.join(PHOTO_DIR, `${safeId(studentId)}.json`);
}

function binaryPath(studentId: string, mime?: string) {
  return path.join(PHOTO_DIR, `${safeId(studentId)}.${extForMime(mime || "image/jpeg")}`);
}

export async function listPhotoStudentIds(): Promise<string[]> {
  if (pool) {
    try {
      await ensurePg();
      const res = await pool!.query(`SELECT student_id FROM pont_student_photos`);
      return res.rows.map((r) => String(r.student_id));
    } catch (err) {
      console.error("[photos] list pg failed:", err);
    }
  }
  try {
    await ensureDir();
    const files = await readdir(PHOTO_DIR);
    const ids = new Set<string>();
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(await readFile(path.join(PHOTO_DIR, f), "utf8")) as StoredPhoto;
        if (meta.studentId) ids.add(meta.studentId);
      } catch {
        // ignore
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

export async function saveStudentPhoto(input: {
  studentId: string;
  buffer: Buffer;
  mime: string;
}): Promise<StoredPhoto> {
  const mime = normalizeMime(input.mime);
  if (!ALLOWED.has(mime) && !mime.startsWith("image/")) {
    throw new Error("Format no suportat. Usa JPG, PNG o WEBP.");
  }
  if (input.buffer.length < 32) throw new Error("Imatge buida.");
  if (input.buffer.length > MAX_BYTES) throw new Error("Imatge massa gran (màx. 6 MB).");
  const meta: StoredPhoto = {
    studentId: input.studentId,
    mime: mime.startsWith("image/") ? mime : "image/jpeg",
    bytes: input.buffer.length,
    updatedAt: new Date().toISOString(),
  };
  if (pool) {
    await ensurePg();
    await pool!.query(
      `
      INSERT INTO pont_student_photos (student_id, mime, bytes, data, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (student_id)
      DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, data = EXCLUDED.data, updated_at = NOW()
      `,
      [input.studentId, meta.mime, meta.bytes, input.buffer],
    );
    return meta;
  }
  await ensureDir();
  await deleteStudentPhotoFiles(input.studentId);
  await writeFile(binaryPath(input.studentId, meta.mime), input.buffer);
  await writeFile(metaPath(input.studentId), JSON.stringify(meta));
  return meta;
}

export async function readStudentPhoto(studentId: string): Promise<{
  buffer: Buffer;
  mime: string;
  meta: StoredPhoto;
} | null> {
  if (pool) {
    try {
      await ensurePg();
      const res = await pool!.query(
        `SELECT mime, bytes, data, updated_at FROM pont_student_photos WHERE student_id = $1 LIMIT 1`,
        [studentId],
      );
      const row = res.rows[0];
      if (!row) return null;
      const buffer = Buffer.from(row.data);
      const meta: StoredPhoto = {
        studentId,
        mime: row.mime,
        bytes: Number(row.bytes) || buffer.length,
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      return { buffer, mime: meta.mime, meta };
    } catch (err) {
      console.error("[photos] read pg failed:", err);
    }
  }
  try {
    const raw = await readFile(metaPath(studentId), "utf8");
    const meta = JSON.parse(raw) as StoredPhoto;
    const buffer = await readFile(binaryPath(studentId, meta.mime));
    return { buffer, mime: meta.mime || "image/jpeg", meta };
  } catch {
    return null;
  }
}

async function deleteStudentPhotoFiles(studentId: string) {
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

export async function deleteStudentPhoto(studentId: string) {
  if (pool) {
    try {
      await ensurePg();
      await pool!.query(`DELETE FROM pont_student_photos WHERE student_id = $1`, [studentId]);
    } catch (err) {
      console.error("[photos] delete pg failed:", err);
    }
  }
  await deleteStudentPhotoFiles(studentId);
}

export function photoPublicUrl(studentId: string) {
  return `/api/students/${encodeURIComponent(studentId)}/photo`;
}

export function photosBackend() {
  return pool ? "postgres" : "file";
}
