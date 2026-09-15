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
    .map((cell) => clean($(cell).text()))
    .filter(Boolean);
}

export function parseStudents(html: string): Student[] {
  const $ = cheerio.load(html);
  if ($("#imc-form-login").length) return [];
  const students: Student[] = [];
  $("select[name*='alum'], select[id*='alum'] option, .imc-alumne, .alumno, [data-alumno]").each(
    (i, el) => {
      const name = clean($(el).text());
      const id = $(el).attr("value") || $(el).attr("data-alumno") || String(i);
      if (!name || /seleccion|triar|elegir|selecciona/i.test(name)) return;
      students.push({ id, name });
    },
  );
  return uniqueStudents(students);
}

export function parseNotices(html: string): Notice[] {
  const $ = cheerio.load(html);
  const notices: Notice[] = [];
  $("table tr").each((i, row) => {
    const cells = rowCells($, row);
    if (cells.length < 2) return;
    if (/fecha|data|avis|aviso|títol|titulo/i.test(cells.join(" "))) return;
    notices.push({
      id: `n-${i}`,
      date: cells[0],
      title: cells[1] ?? "Avís",
      body: cells.slice(2).join(" · ") || cells[1] || "",
      author: cells[3],
    });
  });
  if (notices.length) return notices;
  $(".imc-aviso, .aviso, article, .imc-mensaje").each((i, el) => {
    const title = clean($(el).find("h2, h3, .titulo, strong").first().text()) || clean($(el).text()).slice(0, 80);
    const body = clean($(el).text());
    if (!title) return;
    notices.push({ id: `n-${i}`, title, body });
  });
  return notices;
}

export function parseAbsences(html: string): Absence[] {
  const $ = cheerio.load(html);
  const absences: Absence[] = [];
  $("table tr").each((i, row) => {
    const cells = rowCells($, row);
    if (cells.length < 2) return;
    if (/fecha|data|assignatura|materia|falta/i.test(cells.join(" ")) && i === 0) return;
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
    const cells = rowCells($, row);
    if (cells.length < 2) return;
    if (/assignatura|materia|nota|evaluación|avaluació/i.test(cells.join(" ")) && i === 0) return;
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
    const cells = rowCells($, row);
    if (cells.length < 2) return;
    if (/remitent|de|asunto|assumpte|fecha/i.test(cells.join(" ")) && i === 0) return;
    messages.push({
      id: `m-${i}`,
      date: cells[0],
      from: cells[1] ?? "—",
      subject: cells[2] ?? cells[1] ?? "Missatge",
      preview: cells.slice(3).join(" · "),
    });
  });
  return messages;
}

export function parseActivities(html: string): Activity[] {
  const $ = cheerio.load(html);
  const activities: Activity[] = [];
  $("table tr").each((i, row) => {
    const cells = rowCells($, row);
    if (cells.length < 2) return;
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
    const cells = rowCells($, row);
    if (cells.length < 2) return;
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

function uniqueStudents(students: Student[]) {
  const seen = new Set<string>();
  return students.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
