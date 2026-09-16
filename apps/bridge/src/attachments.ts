import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment, AttachmentKind } from "@pont/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PDF_DIR =
  process.env.PONT_PDF_DIR ??
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "pont", "pdfs")
    : path.join(__dirname, "../.data/pdfs"));

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
  await ensurePdfDir();
  const hash = sha256(input.buffer);
  const safeName = sanitizeFilename(input.filename || `doc-${hash.slice(0, 10)}.pdf`);
  const diskName = `${hash.slice(0, 16)}_${safeName}`;
  const diskPath = path.join(PDF_DIR, diskName);
  try {
    await readFile(diskPath);
  } catch {
    await writeFile(diskPath, input.buffer);
  }
  return {
    id: hash.slice(0, 16),
    filename: safeName,
    sourceUrl: input.sourceUrl,
    sha256: hash,
    bytes: input.buffer.length,
    kind: classifyAttachment(safeName, input.title),
    noticeId: input.noticeId,
    studentId: input.studentId,
  };
}

export function pdfDiskPath(attachment: Attachment) {
  return path.join(PDF_DIR, `${attachment.id}_${sanitizeFilename(attachment.filename)}`);
}

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\- ()àáèéíòóúüïçñÀÁÈÉÍÒÓÚÜÏÇÑ]+/gi, "_").slice(0, 120) || "file.pdf";
}
