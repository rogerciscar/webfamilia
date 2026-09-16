/**
 * Menu PDF extraction via pdfjs-dist text positions + A1–A5 column geometry.
 * (Not pdftotext / linear layout.)
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { MenuDay, MenuExtraction, MenuVariant } from "@pont/shared";

const WEEKDAYS = ["DILLUNS", "DIMARTS", "DIMECRES", "DIJOUS", "DIVENDRES"] as const;

const MONTHS: Record<string, number> = {
  gener: 1,
  enero: 1,
  febrer: 2,
  febrero: 2,
  març: 3,
  marc: 3,
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

const DESSERT_RE = /^-(FRUITA|YOGURT|LACTI)\b/i;
const SALAD_CODE_RE = /^A[1-5]$/;
const AMANIDA_RE = /Amanida\s*([1-5])\s*:\s*(.+)/i;
const DAY_RE = /^([1-9]|[12]\d|3[01])$/;

type Word = { x0: number; y0: number; x1: number; y1: number; text: string; xc: number; yc: number };
type PageWords = { width: number; height: number; words: Word[]; text: string; info?: Record<string, unknown> };

function median(nums: number[]) {
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function clusterYs(ys: number[], tol = 14) {
  if (!ys.length) return [];
  const sorted = [...ys].sort((a, b) => a - b);
  const groups: number[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const y = sorted[i]!;
    if (Math.abs(y - groups[groups.length - 1]!.at(-1)!) <= tol) groups[groups.length - 1]!.push(y);
    else groups.push([y]);
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length);
}

async function loadPageWords(data: Uint8Array): Promise<PageWords[]> {
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages: PageWords[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words: Word[] = [];
    for (const it of content.items) {
      const item = it as { str?: string; transform: number[]; width?: number };
      if (!item.str || !String(item.str).trim()) continue;
      const x0 = item.transform[4]!;
      const yBottom = item.transform[5]!;
      const fontHeight = Math.abs(item.transform[3]!) || 10;
      const width = item.width ?? String(item.str).length * 5;
      const y0 = viewport.height - yBottom - fontHeight;
      const y1 = viewport.height - yBottom;
      const x1 = x0 + width;
      const parts = String(item.str).split(/(\s+)/).filter((p) => p.trim());
      if (parts.length <= 1) {
        words.push({ x0, y0, x1, y1, text: String(item.str).trim(), xc: (x0 + x1) / 2, yc: (y0 + y1) / 2 });
      } else {
        let x = x0;
        const totalChars = parts.reduce((s, p) => s + p.length, 0) || 1;
        for (const part of parts) {
          const w = (width * part.length) / totalChars;
          words.push({ x0: x, y0, x1: x + w, y1, text: part.trim(), xc: x + w / 2, yc: (y0 + y1) / 2 });
          x += w + (width * 0.15) / parts.length;
        }
      }
    }
    const text = content.items.map((it) => ("str" in it ? String(it.str || "") : "")).join(" ");
    pages.push({ width: viewport.width, height: viewport.height, words, text });
  }
  try {
    const md = await doc.getMetadata();
    if (pages[0]) pages[0].info = (md?.info as Record<string, unknown>) || {};
  } catch {
    if (pages[0]) pages[0].info = {};
  }
  return pages;
}

function detectMonthYear(words: Word[], info: Record<string, unknown> | undefined, yearHint?: number) {
  const joined = words.map((w) => w.text).join(" ");
  let month: number | null = null;
  for (const [name, num] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(joined)) {
      month = num;
      break;
    }
  }
  if (!month) throw new Error("No s'ha detectat el mes al PDF de menú");
  let year: number | null = null;
  const title = String(info?.Title || info?.title || "");
  const m = title.match(/\b(20\d{2})\b/);
  if (m) year = Number(m[1]);
  else {
    const m2 = title.match(/\b(\d{2})\s*-\s*\d{2}\b/);
    if (m2) year = 2000 + Number(m2[1]);
  }
  if (year == null) {
    const years = words.map((w) => w.text).filter((t) => /^20\d{2}$/.test(t)).map(Number);
    year = years[0] ?? yearHint ?? new Date().getFullYear();
  }
  if (year < 100) year += 2000;
  return { year, month };
}

function extractSalads(words: Word[]) {
  const left = words.filter((w) => w.x0 > 20 && w.x0 < 240);
  const lines = new Map<number, Word[]>();
  for (const w of left) {
    const key = Math.round(w.y0);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push(w);
  }
  const salads: Record<string, string> = {};
  for (const y of [...lines.keys()].sort((a, b) => a - b)) {
    const text = lines.get(y)!.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" ");
    const m = text.match(AMANIDA_RE);
    if (m) salads[`A${m[1]}`] = m[2]!.replace(/\.$/, "").trim();
  }
  return salads;
}

function isDayMarker(w: Word, words: Word[]) {
  if (!DAY_RE.test(w.text)) return false;
  if (w.x0 < 110) return false;
  for (const o of words) {
    if (Math.abs(o.y0 - w.y0) >= 6 || Math.abs(o.x0 - w.x0) >= 140) continue;
    const t = o.text;
    if (t.toLowerCase().startsWith("kcal")) return false;
    if (/^HC\.?\d*[\d.]*$/i.test(t)) return false;
    if (/^[PL]\.?\d*[\d.]*$/i.test(t)) return false;
  }
  return true;
}

function aCodeEdges(words: Word[], pageW: number) {
  const xs: Record<string, number[]> = { A1: [], A2: [], A3: [], A4: [], A5: [] };
  for (const w of words) {
    if (SALAD_CODE_RE.test(w.text)) xs[w.text.toUpperCase()]!.push(w.x0);
  }
  if (Object.values(xs).every((a) => a.length)) {
    return [1, 2, 3, 4, 5].map((i) => median(xs[`A${i}`]!)).concat([pageW]);
  }
  const headers: Record<string, number> = {};
  for (const w of words) {
    const u = w.text.toUpperCase();
    if ((WEEKDAYS as readonly string[]).includes(u)) headers[u] = w.x0;
  }
  if (Object.keys(headers).length === 5) {
    return WEEKDAYS.map((d) => headers[d]!).concat([pageW]);
  }
  throw new Error("No es poden derivar columnes A1–A5 / dies");
}

function colRange(col: number, edges: number[]) {
  return [edges[col]! - 4, edges[col + 1]! - 2] as const;
}

function weekGroups(dayMarks: [number, Word][]) {
  const weekYs = clusterYs(dayMarks.map(([, w]) => w.y0), 14);
  const groups = new Map<number, [number, Word][]>();
  for (const [num, w] of dayMarks) {
    let best = weekYs[0]!;
    let bestD = Infinity;
    for (const wy of weekYs) {
      const d = Math.abs(wy - w.y0);
      if (d < bestD) {
        bestD = d;
        best = wy;
      }
    }
    if (!groups.has(best)) groups.set(best, []);
    groups.get(best)!.push([num, w]);
  }
  return { groups, weekYs: [...groups.keys()].sort((a, b) => a - b) };
}

function weekYRange(wy: number, weekYs: number[], pageH: number) {
  const after = weekYs.filter((y) => y > wy + 15);
  const y1 = after.length ? Math.min(...after) - 6 : pageH - 35;
  return [wy - 4, y1] as const;
}

function lineText(ws: Word[]) {
  return ws.slice().sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" ");
}

function parseNutrition(cell: Word[]) {
  const kcalWords = cell.filter((w) => w.text.toLowerCase().startsWith("kcal"));
  if (!kcalWords.length) return undefined;
  const ky = kcalWords[0]!.y0;
  const band = cell.filter((w) => Math.abs(w.y0 - ky) < 10);
  let text = lineText(band).replace(/HC /g, "HC.").replace(/P /g, "P.").replace(/L /g, "L.");
  let m = text.match(/Kcal\s*(\d+)\s*HC\.?\s*([\d.]+)\s*P\.?\s*([\d.]+)\s*L\.?\s*([\d.]+)/i);
  if (m) return { kcal: +m[1]!, hc: +m[2]!, p: +m[3]!, l: +m[4]! };
  m = text.match(/Kcal\s*(\d+)/i);
  if (!m) return undefined;
  const out: { kcal: number; hc?: number; p?: number; l?: number } = { kcal: +m[1]! };
  for (const [key, pat] of [
    ["hc", /HC\.?\s*([\d.]+)/i] as const,
    ["p", /P\.?\s*([\d.]+)/i] as const,
    ["l", /L\.?\s*([\d.]+)/i] as const,
  ]) {
    const mm = text.match(pat);
    if (mm) out[key] = +mm[1]!;
  }
  return out;
}

function mergeCourseLines(lines: string[]) {
  const cont = [
    "en ", "de ", "amb ", "acompanyat", "saltada", "casolana", "verdures",
    "d'", "la ", "el ", "ratllada", "tendres", "preferida", "cremosa",
    "caramel", "jardinera",
  ];
  const courses: string[] = [];
  for (let line of lines) {
    line = line.replace(/^[, ]+|[, ]+$/g, "");
    if (!line || line.length < 2) continue;
    const prev = courses[courses.length - 1];
    if (
      prev &&
      (/^[a-zàèéíóú]/.test(line) ||
        cont.some((c) => line.toLowerCase().startsWith(c)) ||
        (prev.split(/\s+/).length <= 3 && !/^[A-ZÀÈÉÍÓÚÄËÏÖÜ]/.test(line)))
    ) {
      courses[courses.length - 1] = `${prev} ${line}`;
    } else courses.push(line);
  }
  if (courses.length > 2) return [courses[0]!, courses.slice(1).join(" ")];
  return courses;
}

function parseCellCourses(cell: Word[], dayNum: number, mark: Word, basal: boolean) {
  let courseWords: Word[] = [];
  for (const w of cell) {
    const t = w.text;
    if (t === String(dayNum) && Math.abs(w.y0 - mark.y0) < 6) continue;
    if (SALAD_CODE_RE.test(t)) continue;
    if (DESSERT_RE.test(t)) continue;
    if (t.toLowerCase().startsWith("kcal")) continue;
    if (/^(HC\.?\d*[\d.]*|P\.?\d*[\d.]*|L\.?\d*[\d.]*|\d+)$/i.test(t)) {
      if (cell.some((o) => Math.abs(o.y0 - w.y0) < 8 && o.text.toLowerCase().startsWith("kcal"))) continue;
    }
    if (/trimestre/i.test(t) || ["el", "de:", "de"].includes(t.toLowerCase())) continue;
    if (basal && /^amanida/i.test(t) && w.x0 < 250) continue;
    courseWords.push(w);
  }
  const aOrKcal = cell.filter(
    (w) => SALAD_CODE_RE.test(w.text) || w.text.toLowerCase().startsWith("kcal"),
  );
  if (aOrKcal.length) {
    const bandY = aOrKcal[0]!.y0;
    courseWords = courseWords.filter((w) => Math.abs(w.y0 - bandY) > 8);
  }
  const lineMap = new Map<number, Word[]>();
  for (const w of courseWords) {
    const key = Math.round(w.y0 / 2) * 2;
    if (!lineMap.has(key)) lineMap.set(key, []);
    lineMap.get(key)!.push(w);
  }
  const lines: string[] = [];
  for (const y of [...lineMap.keys()].sort((a, b) => a - b)) {
    const line = lineText(lineMap.get(y)!).trim();
    if (/Kcal/i.test(line)) continue;
    if (line) lines.push(line);
  }
  return mergeCourseLines(lines);
}

function parseBasalPage(page: PageWords, year: number, month: number): MenuVariant {
  const { words, height: pageH, width: pageW, text } = page;
  const salads = extractSalads(words);
  const edges = aCodeEdges(words, pageW);
  const dayMarks = words.filter((w) => isDayMarker(w, words)).map((w) => [Number(w.text), w] as [number, Word]);
  const { groups, weekYs } = weekGroups(dayMarks);
  const days: MenuDay[] = [];
  for (const [wy, marks] of groups) {
    const [y0, y1] = weekYRange(wy, weekYs, pageH);
    for (const [dayNum, mark] of marks) {
      const dt = new Date(Date.UTC(year, month - 1, dayNum));
      if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== dayNum) continue;
      const weekday = dt.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const col = weekday - 1;
      const [x0, x1] = colRange(col, edges);
      const cell = words.filter((w) => w.yc >= y0 && w.yc <= y1 && w.xc >= x0 && w.xc < x1);
      const salad = cell.find((w) => SALAD_CODE_RE.test(w.text))?.text.toUpperCase();
      const dessertItem = cell.find((w) => DESSERT_RE.test(w.text));
      const dessert = dessertItem ? dessertItem.text.match(DESSERT_RE)?.[1]?.toUpperCase() : undefined;
      const nutrition = parseNutrition(cell);
      const courses = parseCellCourses(cell, dayNum, mark, true);
      days.push({
        date: dt.toISOString().slice(0, 10),
        dayOfMonth: dayNum,
        weekday: WEEKDAYS[col]!,
        courses,
        saladCode: salad,
        dessert,
        nutrition,
      });
    }
  }
  days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  const notes: string[] = [];
  if (/pa integral/i.test(text)) notes.push("Dimarts i dijous: pa integral");
  return {
    name: "Menú basal",
    salads: Object.keys(salads).length ? salads : undefined,
    notes: notes.length ? notes : undefined,
    days,
  };
}

function synthesizeNitsEdges(words: Word[], year: number, month: number, pageW: number) {
  try {
    return aCodeEdges(words, pageW);
  } catch {
    // fall through
  }
  const headers: Record<string, number> = {};
  for (const w of words) {
    const u = w.text.toUpperCase();
    if ((WEEKDAYS as readonly string[]).includes(u)) headers[u] = w.x0;
  }
  if (Object.keys(headers).length === 5) {
    return WEEKDAYS.map((d) => headers[d]!).concat([pageW]);
  }
  const dayMarks = words.filter((w) => isDayMarker(w, words)).map((w) => [Number(w.text), w] as [number, Word]);
  const { groups } = weekGroups(dayMarks);
  let fullest: [number, Word][] = [];
  for (const marks of groups.values()) if (marks.length > fullest.length) fullest = marks;
  const colX: Record<number, number> = {};
  for (const [num, mark] of fullest) {
    const dt = new Date(Date.UTC(year, month - 1, num));
    if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== num) continue;
    const wd = dt.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    colX[wd - 1] = mark.xc - 60;
  }
  const xs: number[] = [];
  for (let i = 0; i < 5; i++) {
    if (colX[i] != null) xs.push(colX[i]!);
    else if (i > 0 && colX[i - 1] != null) xs.push(colX[i - 1]! + 130);
    else xs.push(40 + i * 130);
  }
  return xs.concat([pageW]);
}

function parseNitsPage(page: PageWords, year: number, month: number, edgesHint?: number[]): MenuVariant {
  const { words, height: pageH, width: pageW } = page;
  const edges = edgesHint || synthesizeNitsEdges(words, year, month, pageW);
  const dayMarks = words.filter((w) => isDayMarker(w, words)).map((w) => [Number(w.text), w] as [number, Word]);
  const { groups, weekYs } = weekGroups(dayMarks);
  const days: MenuDay[] = [];
  for (const [wy, marks] of groups) {
    const [y0, y1] = weekYRange(wy, weekYs, pageH);
    for (const [dayNum, mark] of marks) {
      const dt = new Date(Date.UTC(year, month - 1, dayNum));
      if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== dayNum) continue;
      const weekday = dt.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const col = weekday - 1;
      const [x0, x1] = colRange(col, edges);
      const cell = words.filter((w) => w.yc >= y0 && w.yc <= y1 && w.xc >= x0 && w.xc < x1);
      const dessertItem = cell.find((w) => DESSERT_RE.test(w.text));
      const dessert = dessertItem ? dessertItem.text.match(DESSERT_RE)?.[1]?.toUpperCase() : undefined;
      const courses = parseCellCourses(cell, dayNum, mark, false);
      days.push({
        date: dt.toISOString().slice(0, 10),
        dayOfMonth: dayNum,
        weekday: WEEKDAYS[col]!,
        courses,
        dessert,
      });
    }
  }
  days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  return { name: "Menú complementari nits", days };
}

export async function extractMenuFromPdf(
  buffer: Buffer,
  meta: { sourceFile: string; centerName?: string; provider?: string; yearHint?: number },
): Promise<MenuExtraction | null> {
  const pages = await loadPageWords(new Uint8Array(buffer));
  if (!pages.length) return null;
  const info = pages[0]!.info || {};
  const { year, month } = detectMonthYear(pages[0]!.words, info, meta.yearHint);
  let center = meta.centerName;
  const texts = new Set(pages[0]!.words.map((w) => w.text));
  if (!center && texts.has("CARLES") && texts.has("SALVADOR")) center = "CARLES SALVADOR";
  if (!center && pages[0]!.words.some((w) => /CARLES\s+SALVADOR/i.test(w.text))) {
    center = "CARLES SALVADOR";
  }
  const basal = parseBasalPage(pages[0]!, year, month);
  const variants: MenuVariant[] = [basal];
  let basalEdges: number[] | undefined;
  try {
    basalEdges = aCodeEdges(pages[0]!.words, pages[0]!.width);
  } catch {
    basalEdges = undefined;
  }
  if (pages[1] && /complementari|nits/i.test(pages[1].text)) {
    variants.push(parseNitsPage(pages[1], year, month, basalEdges));
  }
  if (!variants.some((v) => v.days.length)) return null;
  const provider =
    meta.provider ||
    String(info.Author || info.author || "") ||
    undefined;
  return {
    sourceFile: meta.sourceFile,
    centerName: center,
    provider: provider || detectProviderFromWords(pages[0]!.words) || "LLUM I TAULA",
    year,
    month,
    variants,
  };
}

function detectProviderFromWords(words: Word[]) {
  const joined = words.map((w) => w.text).join(" ");
  if (/LLUM\s+I\s+TAULA/i.test(joined)) return "LLUM I TAULA";
  return undefined;
}

/** Fallback / fixture parser for layout text dumps (pdftotext-style). */
export function parseMenuText(
  text: string,
  meta: { sourceFile: string; centerName?: string; provider?: string },
): MenuExtraction | null {
  const year = detectYearText(text) ?? new Date().getFullYear();
  const month = detectMonthText(text) ?? 9;
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
    centerName: meta.centerName ?? (/CARLES\s+SALVADOR/i.test(text) ? "CARLES SALVADOR" : undefined),
    provider: meta.provider ?? (/LLUM\s+I\s+TAULA/i.test(text) ? "LLUM I TAULA" : undefined),
    year,
    month,
    variants,
  };
}

function parseVariantBlock(block: string, year: number, month: number): MenuVariant | null {
  const name =
    /men[uú]\s+complementari\s+nits/i.test(block)
      ? "Menú complementari nits"
      : /men[uú]\s+basal/i.test(block)
        ? "Menú basal"
        : "Menú";
  const salads = parseSaladsText(block);
  const notes: string[] = [];
  const noteMatch = block.match(/\*[^\n]+/g);
  if (noteMatch) notes.push(...noteMatch.map((n) => n.trim()));
  const days = parseDaysText(block, year, month);
  if (!days.length && !Object.keys(salads).length) return null;
  return {
    name,
    salads: Object.keys(salads).length ? salads : undefined,
    notes: notes.length ? notes : undefined,
    days,
  };
}

function parseSaladsText(block: string) {
  const salads: Record<string, string> = {};
  const re = /Amanida\s*([1-5])\s*[:：]\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    salads[`A${m[1]}`] = m[2]!.replace(/\s+/g, " ").trim();
  }
  return salads;
}

function parseDaysText(block: string, year: number, month: number): MenuDay[] {
  const days: MenuDay[] = [];
  const cellRe = /(?:^|\n)\s*(\d{1,2})\s*\n([\s\S]*?)(?=(?:\n\s*\d{1,2}\s*\n)|$)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<number>();
  while ((m = cellRe.exec(block))) {
    const dayOfMonth = Number(m[1]);
    if (dayOfMonth < 1 || dayOfMonth > 31 || seen.has(dayOfMonth)) continue;
    const body = m[2]!;
    if (!/Kcal|A[1-5]|FRUITA|YOGURT|LACTI|Arr[oò]s|Mandonguill|Sopa|Amanida/i.test(body)) continue;
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
    days.push({
      date,
      dayOfMonth,
      weekday: weekdayFor(year, month, dayOfMonth),
      courses,
      saladCode: salad ? `A${salad[1]}` : undefined,
      dessert: dessert?.[1]?.toUpperCase(),
      nutrition: nutr
        ? {
            kcal: Number(nutr[1]),
            hc: Number(nutr[2]!.replace(",", ".")),
            p: Number(nutr[3]!.replace(",", ".")),
            l: Number(nutr[4]!.replace(",", ".")),
          }
        : undefined,
    });
  }
  return days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
}

function weekdayFor(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const idx = d.getUTCDay();
  if (idx >= 1 && idx <= 5) return WEEKDAYS[idx - 1]!;
  return ["DIUMENGE", "DILLUNS", "DIMARTS", "DIMECRES", "DIJOUS", "DIVENDRES", "DISSABTE"][idx]!;
}

function detectMonthText(text: string) {
  const m =
    text.match(/MES\s*:\s*([A-Za-zàáèéíòóúüçñ]+)/i) ||
    text.match(
      /\b(Setembre|Septiembre|Octubre|Novembre|Noviembre|Desembre|Diciembre|Gener|Enero|Febrer|Febrero|Març|Marzo|Abril|Maig|Mayo|Juny|Junio|Juliol|Julio|Agost|Agosto)\b/i,
    );
  if (!m) return undefined;
  return MONTHS[m[1]!.toLowerCase()];
}

function detectYearText(text: string) {
  const m = text.match(/\b(20\d{2})\b/) || text.match(/\b(2[6-9])\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n < 100 ? 2000 + n : n;
}
