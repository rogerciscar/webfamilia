import * as cheerio from "cheerio";
import type {
  Absence,
  Activity,
  Behavior,
  Grade,
  Message,
  Notice,
  Student,
} from "@pont/shared";

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function rowCells($: ReturnType<typeof cheerio.load>, row: unknown) {
  return $(row as never)
    .find("td, th")
    .toArray()
    .map((cell) => clean($(cell).text()));
}

function isHeaderRow(cells: string[], i: number) {
  if (i !== 0 && cells.every((c) => c.length < 40)) {
    // still allow later checks
  }
  const blob = cells.join(" ").toLowerCase();
  return (
    i === 0 &&
    /(fecha|data|t[ií]tol|titulo|assumpte|asunto|assignatura|materia|alumne|alumno|remitent|nota|avaluaci|evaluaci)/i.test(
      blob,
    )
  );
}

export function parseStudents(html: string): Student[] {
  const $ = cheerio.load(html);
  if ($("#imc-form-login").length) return [];
  const students: Student[] = [];
  $(
    "select[name*='alum'] option, select[id*='alum'] option, select[name*='hijo'] option, .imc-alumne, .alumno, [data-alumno], .imc-nombre-alumno, .nombreAlumno",
  ).each((i, el) => {
    const name = clean($(el).text());
    const id = $(el).attr("value") || $(el).attr("data-alumno") || String(i);
    if (!name || /seleccion|triar|elegir|selecciona|escoll/i.test(name)) return;
    if (name.length < 3 || name.length > 90) return;
    students.push({ id, name });
  });
  return uniqueStudents(students);
}

export function parseNotices(html: string): Notice[] {
  const $ = cheerio.load(html);
  const notices: Notice[] = [];
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = rowCells($, row).filter(Boolean);
    if (cells.length < 1) return;
    if (isHeaderRow(cells, i)) return;
    notices.push({
      id: `n-${i}`,
      date: cells[0],
      title: cells[1] ?? cells[0] ?? "Avís",
      body: cells.slice(2).join(" · ") || cells[1] || cells[0] || "",
      author: cells[3],
    });
  });
  if (notices.length) return notices;
  $(
    ".imc-aviso, .aviso, .imc-mensaje, .mensaje, article, li.aviso, .imc-llista li, .imc-lista li, .imc-tarjeta, .card",
  ).each((i, el) => {
    const title =
      clean($(el).find("h2, h3, h4, .titulo, .titol, strong, a").first().text()) ||
      clean($(el).text()).slice(0, 90);
    const body = clean($(el).text());
    if (!title || title.length < 3) return;
    if (/entrar|login|contrasenya|contraseña/i.test(title)) return;
    notices.push({ id: `n-${i}`, title, body });
  });
  return notices;
}

export function parseAbsences(html: string): Absence[] {
  const $ = cheerio.load(html);
  const absences: Absence[] = [];
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = rowCells($, row).filter(Boolean);
    if (cells.length < 2) return;
    if (isHeaderRow(cells, i)) return;
    const blob = cells.join(" ").toLowerCase();
    const kind: Absence["kind"] = /retard|retraso/.test(blob)
      ? "retard"
      : /falta|absen/.test(blob)
        ? "falta"
        : "desconegut";
    absences.push({
      id: `a-${i}`,
      date: cells[0],
      subject: cells[1],
      kind,
      justified: /justific/i.test(blob),
      comment: cells.slice(2).join(" · "),
    });
  });
  return absences;
}

export function parseGrades(html: string): Grade[] {
  const $ = cheerio.load(html);
  const grades: Grade[] = [];
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = rowCells($, row).filter(Boolean);
    if (cells.length < 2) return;
    if (isHeaderRow(cells, i)) return;
    grades.push({
      id: `g-${i}`,
      subject: cells[0],
      evaluation: cells[1],
      value: cells[2] ?? cells[1] ?? "—",
      comment: cells.slice(3).join(" · "),
    });
  });
  return grades;
}

export function parseMessages(html: string): Message[] {
  const $ = cheerio.load(html);
  const messages: Message[] = [];
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = rowCells($, row).filter(Boolean);
    if (cells.length < 2) return;
    if (isHeaderRow(cells, i)) return;
    messages.push({
      id: `m-${i}`,
      date: cells[0],
      from: cells[1] ?? "—",
      subject: cells[2] ?? cells[1] ?? "Missatge",
      preview: cells.slice(3).join(" · "),
    });
  });
  if (messages.length) return messages;
  $(".imc-mensaje, .mensaje, .mail, .imc-correu").each((i, el) => {
    const subject =
      clean($(el).find(".asunto, .assumpte, strong, h3").first().text()) ||
      clean($(el).text()).slice(0, 80);
    if (!subject) return;
    messages.push({
      id: `m-${i}`,
      subject,
      from: clean($(el).find(".remitent, .de, .from").first().text()) || "—",
      preview: clean($(el).text()),
    });
  });
  return messages;
}

export function parseActivities(html: string): Activity[] {
  const $ = cheerio.load(html);
  const activities: Activity[] = [];
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = rowCells($, row).filter(Boolean);
    if (cells.length < 2) return;
    if (isHeaderRow(cells, i)) return;
    activities.push({
      id: `act-${i}`,
      date: cells[0],
      title: cells[1] ?? "Activitat",
      place: cells[2],
      description: cells.slice(3).join(" · "),
    });
  });
  return activities;
}

export function parseBehaviors(html: string): Behavior[] {
  const $ = cheerio.load(html);
  const behaviors: Behavior[] = [];
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = rowCells($, row).filter(Boolean);
    if (cells.length < 2) return;
    if (isHeaderRow(cells, i)) return;
    behaviors.push({
      id: `b-${i}`,
      date: cells[0],
      subject: cells[1],
      description: cells.slice(2).join(" · ") || cells[1] || "",
      kind: cells[3],
    });
  });
  return behaviors;
}

/** Score how well a page matches a section keyword. */
export function pageScore(key: string, html: string, keywords: RegExp) {
  let score = 0;
  if (keywords.test(key)) score += 5;
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "";
  if (keywords.test(title)) score += 4;
  if (keywords.test(html.slice(0, 2500))) score += 2;
  return score;
}

function uniqueStudents(students: Student[]) {
  const seen = new Set<string>();
  return students.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
