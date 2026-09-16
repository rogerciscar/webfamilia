import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MenuDay, MenuExtraction, MenuVariant } from "@pont/shared";

const execFileAsync = promisify(execFile);

const WEEKDAYS = ["DILLUNS", "DIMARTS", "DIMECRES", "DIJOUS", "DIVENDRES"] as const;

const MONTHS: Record<string, number> = {
  gener: 1,
  enero: 1,
  febrer: 2,
  febrero: 2,
  març: 3,
  marzo: 3,
  abril: 4,
  maig: 5,
  mayo: 5,
  juny: 6,
  junio: 6,
  juliol: 7,
  julio: 7,
  agost: 8,
  agosto: 8,
  setembre: 9,
  septiembre: 9,
  octubre: 10,
  novembre: 11,
  noviembre: 11,
  desembre: 12,
  diciembre: 12,
};

export async function pdfToText(buffer: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "wf-pdf-"));
  const pdfPath = path.join(dir, "in.pdf");
  const txtPath = path.join(dir, "out.txt");
  try {
    await writeFile(pdfPath, buffer);
    await execFileAsync("pdftotext", ["-layout", pdfPath, txtPath], { timeout: 30000 });
    const { readFile } = await import("node:fs/promises");
    return await readFile(txtPath, "utf8");
  } finally {
    try {
      await unlink(pdfPath);
      await unlink(txtPath);
    } catch {
      // ignore
    }
  }
}

export function parseMenuText(
  text: string,
  meta: { sourceFile: string; centerName?: string; provider?: string },
): MenuExtraction | null {
  const year = detectYear(text) ?? new Date().getFullYear();
  const month = detectMonth(text) ?? 9;
  const pages = text.split(/\f/).map((p) => p.trim()).filter(Boolean);
  const blocks = pages.length ? pages : [text];
  const variants: MenuVariant[] = [];
  for (const block of blocks) {
    const variant = parseVariantBlock(block, year, month);
    if (variant && variant.days.length) variants.push(variant);
  }
  if (!variants.length) {
    const fallback = parseVariantBlock(text, year, month);
    if (fallback?.days.length) variants.push(fallback);
  }
  if (!variants.length) return null;
  return {
    sourceFile: meta.sourceFile,
    centerName: meta.centerName ?? detectCenter(text),
    provider: meta.provider ?? detectProvider(text),
    year,
    month,
    variants,
  };
}

export async function extractMenuFromPdf(
  buffer: Buffer,
  meta: { sourceFile: string; centerName?: string; provider?: string },
): Promise<MenuExtraction | null> {
  const text = await pdfToText(buffer);
  return parseMenuText(text, meta);
}

function parseVariantBlock(block: string, year: number, month: number): MenuVariant | null {
  const name =
    /men[uú]\s+complementari\s+nits/i.test(block)
      ? "Menú complementari nits"
      : /men[uú]\s+basal/i.test(block)
        ? "Menú basal"
        : /men[uú]/i.test(block)
          ? "Menú"
          : "Menú";
  const salads = parseSalads(block);
  const notes: string[] = [];
  const noteMatch = block.match(/\*[^\n]+/g);
  if (noteMatch) notes.push(...noteMatch.map((n) => n.trim()));
  const days = parseDays(block, year, month);
  if (!days.length && !Object.keys(salads).length) return null;
  return {
    name,
    salads: Object.keys(salads).length ? salads : undefined,
    notes: notes.length ? notes : undefined,
    days,
  };
}

function parseSalads(block: string) {
  const salads: Record<string, string> = {};
  const re = /Amanida\s*([1-5])\s*[:：]\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    salads[`A${m[1]}`] = m[2].replace(/\s+/g, " ").trim();
  }
  return salads;
}

function parseDays(block: string, year: number, month: number): MenuDay[] {
  const days: MenuDay[] = [];
  // Split into cell-like chunks around day numbers with nutrition markers
  const cellRe =
    /(?:^|\n)\s*(\d{1,2})\s*\n([\s\S]*?)(?=(?:\n\s*\d{1,2}\s*\n)|$)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = cellRe.exec(block))) {
    const dayOfMonth = Number(m[1]);
    if (dayOfMonth < 1 || dayOfMonth > 31 || seen.has(dayOfMonth)) continue;
    const body = m[2];
    if (!/Kcal|A[1-5]|FRUITA|YOGURT|LACTI|Arr[oò]s|Mandonguill|Sopa|Amanida/i.test(body)) {
      continue;
    }
    seen.add(dayOfMonth);
    const salad = body.match(/\bA([1-5])\b/);
    const dessert = body.match(/-?\s*(FRUITA|YOGURT|LACTI)\b/i);
    const nutr = body.match(
      /Kcal\s*(\d+)[\s\S]*?HC\.?\s*([\d.,]+)[\s\S]*?P\.?\s*([\d.,]+)[\s\S]*?L\.?\s*([\d.,]+)/i,
    );
    const courses = body
      .split(/\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(
        (l) =>
          l.length > 2 &&
          !/^(A[1-5]|Kcal|HC|P\.?|L\.?|-?FRUITA|-?YOGURT|-?LACTI|\d+$)/i.test(l) &&
          !/Kcal\s*\d+/i.test(l),
      )
      .slice(0, 4);
    const date = `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
    const weekday = weekdayFor(year, month, dayOfMonth);
    days.push({
      date,
      dayOfMonth,
      weekday,
      courses,
      saladCode: salad ? `A${salad[1]}` : undefined,
      dessert: dessert?.[1]?.toUpperCase(),
      nutrition: nutr
        ? {
            kcal: Number(nutr[1]),
            hc: Number(nutr[2].replace(",", ".")),
            p: Number(nutr[3].replace(",", ".")),
            l: Number(nutr[4].replace(",", ".")),
          }
        : undefined,
    });
  }
  return days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
}

function weekdayFor(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const idx = d.getUTCDay(); // 0 Sun
  if (idx >= 1 && idx <= 5) return WEEKDAYS[idx - 1];
  return ["DIUMENGE", "DILLUNS", "DIMARTS", "DIMECRES", "DIJOUS", "DIVENDRES", "DISSABTE"][idx];
}

function detectMonth(text: string) {
  const m = text.match(/MES\s*:\s*([A-Za-zàáèéíòóúüçñ]+)/i) || text.match(/\b(Setembre|Septiembre|Octubre|Novembre|Noviembre|Desembre|Diciembre|Gener|Enero|Febrer|Febrero|Març|Marzo|Abril|Maig|Mayo|Juny|Junio|Juliol|Julio|Agost|Agosto)\b/i);
  if (!m) return undefined;
  return MONTHS[m[1].toLowerCase()];
}

function detectYear(text: string) {
  const m = text.match(/\b(20\d{2})\b/) || text.match(/\b(2[6-9])\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n < 100 ? 2000 + n : n;
}

function detectCenter(text: string) {
  const m = text.match(/CARLES\s+SALVADOR/i);
  return m ? "CARLES SALVADOR" : undefined;
}

function detectProvider(text: string) {
  const m = text.match(/LLUM\s+I\s+TAULA/i);
  return m ? "LLUM I TAULA" : undefined;
}
