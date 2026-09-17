import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Attachment, AttachmentKind } from "@pont/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PDF_DIR =
  process.env.PONT_PDF_DIR ??
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "pont", "pdfs")
    : path.join(__dirname, "../.data/pdfs"));

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
        CREATE TABLE IF NOT EXISTS pont_pdfs (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          mime TEXT NOT NULL DEFAULT 'application/pdf',
          bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          source_url TEXT,
          kind TEXT,
          notice_id TEXT,
          student_id TEXT,
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

export function classifyAttachment(name: string, title = ""): AttachmentKind {
  const blob = `${name} ${title}`;
  if (/especial/i.test(blob)) return "menu_especial";
  if (/men[uú].*(menjador|setembr|septiem)|menjador.*men[uú]/i.test(blob)) {
    return "menu_menjador";
  }
  if (/agenda|dossier|infograf|informaci/i.test(blob)) return "aviso_doc";
  return "other";
}

export function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function ensurePdfDir() {
  await mkdir(PDF_DIR, { recursive: true });
}

export async function storePdf(input: {
  buffer: Buffer;
  filename: string;
  sourceUrl: string;
  title?: string;
  noticeId?: string;
  studentId?: string;
}): Promise<Attachment> {
  const hash = sha256(input.buffer);
  const safeName = sanitizeFilename(input.filename || `doc-${hash.slice(0, 10)}.pdf`);
  const id = hash.slice(0, 16);
  const kind = classifyAttachment(safeName, input.title);
  const att: Attachment = {
    id,
    filename: safeName,
    sourceUrl: input.sourceUrl,
    sha256: hash,
    bytes: input.buffer.length,
    kind,
    noticeId: input.noticeId,
    studentId: input.studentId,
  };
  if (pool) {
    await ensurePg();
    await pool!.query(
      `
      INSERT INTO pont_pdfs (id, filename, mime, bytes, sha256, source_url, kind, notice_id, student_id, data, updated_at)
      VALUES ($1, $2, 'application/pdf', $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (id) DO UPDATE SET
        filename = EXCLUDED.filename,
        bytes = EXCLUDED.bytes,
        source_url = EXCLUDED.source_url,
        kind = EXCLUDED.kind,
        notice_id = COALESCE(EXCLUDED.notice_id, pont_pdfs.notice_id),
        student_id = COALESCE(EXCLUDED.student_id, pont_pdfs.student_id),
        data = EXCLUDED.data,
        updated_at = NOW()
      `,
      [
        id,
        safeName,
        att.bytes,
        hash,
        input.sourceUrl,
        kind,
        input.noticeId || null,
        input.studentId || null,
        input.buffer,
      ],
    );
  }
  // Best-effort disk mirror (ephemeral on Railway without volume)
  try {
    await ensurePdfDir();
    const diskPath = pdfDiskPath(att);
    try {
      await readFile(diskPath);
    } catch {
      await writeFile(diskPath, input.buffer);
    }
  } catch (err) {
    console.warn("[pdf] disk mirror skipped:", err);
  }
  console.log(`[pdf] saved id=${id} bytes=${att.bytes} kind=${kind} backend=${pool ? "postgres" : "file"}`);
  return att;
}

export function pdfDiskPath(attachment: Attachment) {
  return path.join(PDF_DIR, `${attachment.id}_${sanitizeFilename(attachment.filename)}`);
}

/** Read PDF bytes from Postgres first, then disk. */
export async function readPdfBytes(attachment: Attachment): Promise<Buffer | null> {
  if (pool) {
    try {
      await ensurePg();
      const res = await pool!.query(`SELECT data FROM pont_pdfs WHERE id = $1 LIMIT 1`, [
        attachment.id,
      ]);
      if (res.rows[0]?.data) return Buffer.from(res.rows[0].data);
    } catch (err) {
      console.error("[pdf] pg read failed:", err);
    }
  }
  try {
    return await readFile(pdfDiskPath(attachment));
  } catch {
    return null;
  }
}

export function pdfsBackend() {
  return pool ? "postgres" : "file";
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\- ()àáèéíòóúüïçñÀÁÈÉÍÒÓÚÜÏÇÑ]+/gi, "_").slice(0, 120) || "file.pdf";
}
