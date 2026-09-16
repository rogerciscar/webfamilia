import * as cheerio from "cheerio";
import type {
  Absence,
  Activity,
  Behavior,
  Grade,
  Message,
  Notice,
  ScheduleSlot,
  Student,
  Subject,
} from "@pont/shared";

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function parseStudents(html: string): Student[] {
  const $ = cheerio.load(html);
  if ($("#imc-form-login").length) return [];
  const students: Student[] = [];
  $(".imc-alumno").each((_, el) => {
    const link = $(el).find("a.imc-alumno-nombre").first();
    const name = clean(link.text());
    const id = link.attr("data-id") || link.attr("id") || "";
    if (!name || name.length < 3) return;
    const course = clean($(el).find(".imc-alumno-matriculas a").first().text()) || undefined;
    students.push({ id: id || name, name, course });
  });
  if (students.length) return uniqueStudents(students);
  $(
    "select[name*='alum'] option, select[id*='alum'] option, a.imc-alumno-nombre",
  ).each((i, el) => {
    const name = clean($(el).text());
    const id = $(el).attr("value") || $(el).attr("data-id") || $(el).attr("id") || String(i);
    if (!name || /seleccion|triar|elegir|selecciona|escoll/i.test(name)) return;
    if (name.length < 3 || name.length > 90) return;
    students.push({ id, name });
  });
  return uniqueStudents(students);
}

/** Matrícula links from listar_alumnos page. */
export function parseMatriculaLinks(html: string) {
  const $ = cheerio.load(html);
  const links: { alumnoId: string; matriculaId: string; href: string; label: string }[] = [];
  $("a[href*='alumno_matricula_wf']").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    const m = href.match(/alumno_id=(\d+)/i);
    const n = href.match(/matricula_id=(\d+)/i);
    if (!m || !n) return;
    links.push({
      alumnoId: m[1],
      matriculaId: n[1],
      href: normalizeHref(href),
      label: clean($(el).text()),
    });
  });
  return uniqueBy(links, (l) => l.href);
}

/** Section / module URLs from alumno_matricula_wf AJAX HTML or composed desktop. */
export function parseSectionTargets(html: string) {
  const $ = cheerio.load(html);
  const targets: { href: string; text: string; kind: string }[] = [];
  const push = (href: string | undefined, text: string, kind: string) => {
    const h = normalizeHref(href || "");
    if (!h || h === "javascript:;" || h.startsWith("javascript:")) return;
    targets.push({ href: h, text: clean(text) || kind, kind });
  };
  $(".imc-matricula-menu a, .imc-avisos-menu a, a.bt-comunicaciones").each((_, el) => {
    const href = $(el).attr("href") || $(el).attr("data-href");
    const text = $(el).text();
    const kind = classifySection(href || "", text);
    push(href, text, kind);
  });
  $("ul.imc-es-matricula-secciones a[data-href]").each((_, el) => {
    const href = $(el).attr("data-href");
    const text = $(el).text();
    push(href, text, classifySection(href || "", text));
  });
  $("a.bt-com-todas[href]").each((_, el) => {
    push($(el).attr("href"), $(el).text(), "comunicaciones");
  });
  return uniqueBy(targets, (t) => t.href);
}

export function parseNotices(html: string): Notice[] {
  const $ = cheerio.load(html);
  const notices: Notice[] = [];
  $(".imc-avisos-modulo").each((_, mod) => {
    const title = clean($(mod).find("h2").first().text()).toLowerCase();
    if (title && !/agenda|avis/i.test(title)) return;
    $(mod)
      .find("ul.imc-listado-detalle li, ul.imc-listado-agenda li")
      .each((i, li) => {
        const notice = parseAvisoLi($, li, i);
        if (notice) notices.push(notice);
      });
  });
  if (notices.length) return notices;
  $("ul.imc-listado-agenda li, ul.imc-listado-detalle li").each((i, li) => {
    const notice = parseAvisoLi($, li, i);
    if (notice) notices.push(notice);
  });
  return notices;
}

export function parseAbsences(html: string): Absence[] {
  const $ = cheerio.load(html);
  const absences: Absence[] = [];
  $(".imc-avisos-modulo").each((_, mod) => {
    const title = clean($(mod).find("h2").first().text());
    if (!/assist|asist|falta/i.test(title)) return;
    if ($(mod).find(".imc-sin-datos").length) return;
    $(mod)
      .find("ul.imc-listado-detalle li")
      .each((i, li) => {
        const a = $(li).find("a").first();
        const date =
          clean($(li).attr("data-date") || "") ||
          clean(a.find("span").first().text()) ||
          "";
        const subject = clean(a.find("strong").first().text()) || clean(a.text());
        if (!date && !subject) return;
        const blob = clean($(li).text()).toLowerCase();
        absences.push({
          id: a.attr("data-id") || `a-${i}`,
          date: date || "—",
          subject: subject || undefined,
          kind: /retard|retraso/.test(blob) ? "retard" : "falta",
          justified: /justific/i.test(blob),
          comment: clean($(li).text()),
        });
      });
  });
  return absences;
}

export function parseActivities(html: string): Activity[] {
  const $ = cheerio.load(html);
  const activities: Activity[] = [];
  $(".imc-avisos-modulo").each((_, mod) => {
    const title = clean($(mod).find("h2").first().text());
    if (!/activitat|actividad/i.test(title)) return;
    if ($(mod).find(".imc-sin-datos").length) return;
    $(mod)
      .find("ul.imc-listado-detalle li")
      .each((i, li) => {
        const a = $(li).find("a").first();
        const date =
          clean($(li).attr("data-date") || "") ||
          clean(a.find("span").first().text()) ||
          undefined;
        const actTitle = clean(a.find("strong").first().text()) || clean(a.text());
        if (!actTitle) return;
        activities.push({
          id: a.attr("data-id") || `act-${i}`,
          title: actTitle,
          date,
          description: clean($(li).text()),
        });
      });
  });
  return activities;
}

export function parseMessages(html: string): Message[] {
  const $ = cheerio.load(html);
  const messages: Message[] = [];
  if (
    $(".imc--co-info").length &&
    /no hi ha noves comunicacions|no hay nuevas comunicaciones/i.test(
      $(".imc--co-info").text(),
    )
  ) {
    // empty inbox for "new" — still try list items below
  }
  $(
    ".imc-listado-comunicaciones li, .imc-listado-detalle.imc-listado-comunicaciones li, ul.imc-listado-detalle li a[href*='tipo=cm'], a.bt-av-comunicacion",
  ).each((i, el) => {
    const root = $(el).is("li") ? $(el) : $(el).closest("li");
    const a = root.find("a").first().length ? root.find("a").first() : $(el);
    const subject =
      clean(a.find("strong").first().text()) ||
      clean(a.text()).slice(0, 120);
    if (!subject || /vore-les totes|verlas todas|comunicacions/i.test(subject)) return;
    messages.push({
      id: a.attr("data-id") || `m-${i}`,
      subject,
      from: clean(root.find(".imc-remitent, .remitent").first().text()) || "Centre",
      date: clean(a.find("span").first().text()) || clean(root.attr("data-date") || "") || undefined,
      preview: clean(root.text()),
      unread: root.hasClass("imc-li-de-nuevo") || a.hasClass("imc-li-de-nuevo"),
    });
  });
  if (messages.length) return messages;
  $("table tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = $(row)
      .find("td")
      .toArray()
      .map((c) => clean($(c).text()))
      .filter(Boolean);
    if (cells.length < 2) return;
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

export function parseGrades(html: string): Grade[] {
  const $ = cheerio.load(html);
  if (/no hi ha qualificacions|no hay calificaciones/i.test($.text()) && !$("table tr td").length) {
    return [];
  }
  const grades: Grade[] = [];
  $("table:not(.imc-horarios):not(.imc-materias-tabla) tr").each((i, row) => {
    if ($(row).find("th").length && i === 0) return;
    const cells = $(row)
      .find("td")
      .toArray()
      .map((c) => clean($(c).text()))
      .filter(Boolean);
    if (cells.length < 2) return;
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

export function parseSubjects(html: string): Subject[] {
  const $ = cheerio.load(html);
  const subjects: Subject[] = [];
  $("table.imc-materias-tabla tbody tr").each((i, row) => {
    const subject = clean($(row).find("td").first().text());
    const teacher = clean($(row).find(".imc-profesor-nombre").first().text()) || undefined;
    const attention = clean($(row).find("td").last().text()) || undefined;
    if (!subject) return;
    subjects.push({ id: `s-${i}`, subject, teacher, attention });
  });
  return subjects;
}

export function parseSchedule(html: string): ScheduleSlot[] {
  const $ = cheerio.load(html);
  const slots: ScheduleSlot[] = [];
  $("table.imc-horarios").each((_, table) => {
    const day = clean($(table).find("th.imc-dia").first().text());
    if (!day) return;
    $(table)
      .find("tbody tr")
      .each((i, row) => {
        const timeCell = $(row).find("th.imc-hora, td.imc-hora").first();
        const start = clean(timeCell.find("strong").first().text());
        const endRaw = clean(timeCell.find("span").first().text()).replace(/^-\s*/, "");
        const subject = clean($(row).find("td").last().text());
        if (!subject) return;
        slots.push({
          id: `h-${day}-${i}`,
          day,
          start: start || undefined,
          end: endRaw || undefined,
          subject,
        });
      });
  });
  return slots;
}

export function parseBehaviors(_html: string): Behavior[] {
  return [];
}

export function pageScore(key: string, html: string, keywords: RegExp) {
  let score = 0;
  if (keywords.test(key)) score += 5;
  const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "";
  if (keywords.test(title)) score += 4;
  if (keywords.test(html.slice(0, 2500))) score += 2;
  return score;
}

function parseAvisoLi(
  $: ReturnType<typeof cheerio.load>,
  li: unknown,
  i: number,
): Notice | null {
  const el = $(li as never);
  const a = el.find("a").first();
  const date =
    clean(el.attr("data-date") || "") ||
    clean(a.find("span").first().text()) ||
    undefined;
  const title = clean(a.find("strong").first().text()) || clean(a.text());
  if (!title || title.length < 3) return null;
  if (/entrar|login|contrasenya|contraseña|vore-les totes/i.test(title)) return null;
  return {
    id: a.attr("data-id") || `n-${i}`,
    date,
    title,
    body: clean(el.text()),
    unread: el.hasClass("imc-li-de-nuevo") || a.hasClass("imc-li-de-nuevo"),
  };
}

function classifySection(href: string, text: string) {
  const blob = `${href} ${text}`.toLowerCase();
  if (/horario|horari/.test(blob)) return "horarios";
  if (/calific|qualific|nota/.test(blob)) return "calificaciones";
  if (/materia|assignatur/.test(blob)) return "materias";
  if (/tramit/.test(blob)) return "tramites";
  if (/tipo=cm|comunic/.test(blob)) return "comunicaciones";
  if (/tipo=as|assist|asist|falta/.test(blob)) return "asistencias";
  if (/tipo=ac|activit/.test(blob)) return "actividades";
  if (/tipo=ag|agenda|avisos/.test(blob)) return "agenda";
  if (/avisos/.test(blob)) return "avisos";
  return "other";
}

function normalizeHref(href: string) {
  return href.replace(/&amp;/g, "&").trim();
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

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
