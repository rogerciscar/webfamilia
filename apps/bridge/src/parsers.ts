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
import { extractDateLabel, toIsoDate } from "./dates";

export type StudentCtx = { studentId?: string; studentName?: string };

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
    const group = clean($(el).find(".imc-alumno-matriculas a").first().text()) || undefined;
    students.push({ id: id || name, name, course: group, group });
  });
  if (students.length) return uniqueStudents(students);
  $("a.imc-alumno-nombre").each((i, el) => {
    const name = clean($(el).text());
    const id = $(el).attr("data-id") || $(el).attr("id") || String(i);
    if (!name || name.length < 3 || name.length > 90) return;
    students.push({ id, name });
  });
  return uniqueStudents(students);
}

/** Enrich student from alumno_datos / escritorio HTML. Never reads Identitat digital secrets. */
export function enrichStudent(html: string, base: Student): Student {
  const $ = cheerio.load(html);
  // Strip identity-digital blocks before reading
  $(".imc-identidad-digital").remove();
  const nia =
    clean($(".imc-alumno-dp-nia strong").first().text()) ||
    (html.match(/NIA[^0-9]*(\d{6,})/i)?.[1] ?? undefined);
  const tutorName =
    clean($(".imc-matricula-tutor strong").first().text()) ||
    clean(
      $(".imc-matricula-tutor p")
        .first()
        .text()
        .replace(/^Tutor\s*o?\s*tutor[ao]?s?\s*/i, ""),
    ) ||
    clean($("[class*='tutor'] strong").first().text()) ||
    undefined;
  const group =
    clean($("a.imc-al-matricula.imc-seleccionada, .imc-alumno-matriculas a").first().text()) ||
    base.group ||
    base.course;
  const enrollmentYear =
    clean($(".imc-es-alumno-matriculas h2").first().text()).match(/(\d{4}\s*[-–]\s*\d{4})/)?.[1]?.replace(/\s+/g, "") ||
    undefined;
  const center =
    clean($(".imc-titulo, .imc-centro-datos .imc-titulo, h4 a").first().text()) || base.center;
  return {
    ...base,
    nia: nia || base.nia,
    tutorName: tutorName && tutorName.length > 2 ? tutorName : base.tutorName,
    group: group || base.group,
    course: group || base.course,
    enrollmentYear: enrollmentYear || base.enrollmentYear,
    center: center || base.center,
  };
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

export function parseNotices(html: string, ctx?: StudentCtx): Notice[] {
  const $ = cheerio.load(html);
  const notices: Notice[] = [];
  $(".imc-avisos-modulo").each((_, mod) => {
    const heading = clean($(mod).find("h2").first().text()).toLowerCase();
    if (heading && !/agenda|avis/i.test(heading)) return;
    $(mod)
      .find("ul.imc-listado-detalle li, ul.imc-listado-agenda li")
      .each((i, li) => {
        const notice = parseAvisoLi($, li, i, ctx);
        if (notice) notices.push(notice);
      });
  });
  if (notices.length) return notices;
  $("ul.imc-listado-agenda li, a.bt-av-tarea").each((i, el) => {
    const li = $(el).is("li") ? el : $(el).closest("li").get(0) || el;
    const notice = parseAvisoLi($, li, i, ctx);
    if (notice) notices.push(notice);
  });
  return notices;
}

/** PDF / document links inside aviso detail HTML (WF uses many shapes). */
export function parseDocumentLinks(html: string, baseUrl = "https://familia.edu.gva.es") {
  const $ = cheerio.load(html);
  const links: { href: string; text: string }[] = [];
  const push = (rawHref: string | undefined, text = "") => {
    const href = (rawHref || "").trim();
    if (!href || href === "#" || /^javascript:/i.test(href)) return;
    let absolute = href;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    links.push({
      href: absolute,
      text: clean(text || href.split("/").pop() || "document.pdf"),
    });
  };
  const looksDoc = (href: string, text: string) =>
    /\.pdf(\?|$)/i.test(href) ||
    /application\/pdf/i.test(href) ||
    /documento|adjunto|fichero|descarg|download|visor|attachment|fileid|id_?doc|tipo=pdf|content-disposition/i.test(
      `${href} ${text}`,
    );

  $("a[href], a[data-href], a[data-url], a[data-link], a[data-file]").each((_, el) => {
    const text = clean($(el).text() || $(el).attr("title") || "");
    const candidates = [
      $(el).attr("href"),
      $(el).attr("data-href"),
      $(el).attr("data-url"),
      $(el).attr("data-link"),
      $(el).attr("data-file"),
      $(el).attr("data-documento"),
    ];
    for (const c of candidates) {
      if (c && looksDoc(c, text)) push(c, text);
    }
  });
  $("iframe[src], embed[src], object[data], source[src]").each((_, el) => {
    const href = $(el).attr("src") || $(el).attr("data") || "";
    if (looksDoc(href, "")) push(href, "document.pdf");
  });
  $("[onclick]").each((_, el) => {
    const onclick = $(el).attr("onclick") || "";
    const text = clean($(el).text() || $(el).attr("title") || "");
    const matches = [
      ...onclick.matchAll(/(?:location(?:\.href)?|document\.location)\s*=\s*['"]([^'"]+)['"]/gi),
      ...onclick.matchAll(/window\.open\(\s*['"]([^'"]+)['"]/gi),
      ...onclick.matchAll(/['"]([^'"]*(?:\.pdf|documento|descarg|visor)[^'"]*)['"]/gi),
    ];
    for (const m of matches) {
      if (looksDoc(m[1], text)) push(m[1], text);
    }
  });
  // Raw URLs in HTML/scripts
  const raw =
    html.match(
      /https?:\/\/[^"'>\s]+(?:\.pdf)(?:\?[^"'>\s]*)?|["']([^"'>\s]*(?:documento_wf|visor_documento|descarg\w*_wf|adjunto)[^"'>\s]*)["']/gi,
    ) || [];
  for (const hit of raw) {
    const href = hit.replace(/^["']|["']$/g, "");
    if (looksDoc(href, "")) push(href, href.split("/").pop() || "doc.pdf");
  }
  // Relative WF document endpoints without .pdf
  const rel =
    html.match(
      /(?:href|src|data-href|data-url)\s*=\s*["']([^"']*(?:documento|adjunto|visor|descarg)[^"']*)["']/gi,
    ) || [];
  for (const attr of rel) {
    const m = attr.match(/["']([^"']+)["']/);
    if (m) push(m[1], m[1].split("/").pop() || "doc.pdf");
  }
  return uniqueBy(links, (l) => l.href);
}

export function parseAbsences(html: string): Absence[] {
  const $ = cheerio.load(html);
  const absences: Absence[] = [];
  const pushLi = (li: unknown, i: number) => {
    const el = $(li as never);
    if (el.find(".imc-sin-datos").length) return;
    const a = el.find("a").first();
    const date =
      clean(el.attr("data-date") || "") ||
      clean(a.find("span").first().text()) ||
      extractDateLabel(clean(el.text())) ||
      "";
    const subject =
      clean(a.find("strong").first().text()) ||
      clean(el.find("strong").first().text()) ||
      clean(a.text()) ||
      undefined;
    const blob = clean(el.text());
    if (!date && !subject) return;
    if (/no hi ha faltes|sin faltas|no hay faltas/i.test(blob)) return;
    absences.push({
      id: a.attr("data-id") || el.attr("data-id") || `a-${i}-${date}-${subject || ""}`,
      date: date || "—",
      dateIso: toIsoDate(date),
      subject,
      kind: /retard|retraso/.test(blob.toLowerCase()) ? "retard" : "falta",
      justified: /justific/i.test(blob),
      comment: blob,
    });
  };
  $(".imc-avisos-modulo").each((_, mod) => {
    const title = clean($(mod).find("h2").first().text());
    if (title && !/assist|asist|falta/i.test(title)) return;
    if ($(mod).find(".imc-sin-datos").length && !$(mod).find("ul li").length) return;
    $(mod).find("ul.imc-listado-detalle li, ul.imc-listado-agenda li, table tbody tr").each((i, li) => {
      if ($(li).is("tr")) {
        const cells = $(li).find("td, th").toArray().map((c) => clean($(c).text())).filter(Boolean);
        if (cells.length < 2) return;
        const blob = cells.join(" ");
        if (/no hi ha|sin faltas/i.test(blob)) return;
        const date = extractDateLabel(blob) || cells[0];
        absences.push({
          id: `tr-${i}-${date}`,
          date: date || "—",
          dateIso: toIsoDate(date),
          subject: cells.find((c) => c !== date && !/falta|retard|justific/i.test(c)) || undefined,
          kind: /retard|retraso/.test(blob.toLowerCase()) ? "retard" : "falta",
          justified: /justific/i.test(blob),
          comment: blob,
        });
        return;
      }
      pushLi(li, i);
    });
  });
  if (absences.length) return uniqueBy(absences, (a) => `${a.date}:${a.subject}:${a.kind}`);
  // AJAX fragment without modulo wrapper (tipo=as)
  $("ul.imc-listado-detalle li, ul.imc-listado-agenda li").each((i, li) => pushLi(li, i));
  $("table.imc-tabla tbody tr, table tbody tr").each((i, tr) => {
    const cells = $(tr).find("td").toArray().map((c) => clean($(c).text())).filter(Boolean);
    if (cells.length < 2) return;
    const blob = cells.join(" ");
    if (!/falta|retard|assist|asist|aus[eè]n/i.test(blob + html.slice(0, 400))) return;
    const date = extractDateLabel(blob) || cells[0];
    absences.push({
      id: `tbl-${i}-${date}`,
      date: date || "—",
      dateIso: toIsoDate(date),
      subject: cells[1],
      kind: /retard|retraso/.test(blob.toLowerCase()) ? "retard" : "falta",
      justified: /justific/i.test(blob),
      comment: blob,
    });
  });
  return uniqueBy(absences, (a) => `${a.date}:${a.subject}:${a.kind}`);
}

export function parseActivities(html: string): Activity[] {
  const $ = cheerio.load(html);
  const activities: Activity[] = [];
  const pushLi = (li: unknown, i: number) => {
    const el = $(li as never);
    if (el.find(".imc-sin-datos").length) return;
    const a = el.find("a").first();
    const date =
      clean(el.attr("data-date") || "") ||
      clean(a.find("span").first().text()) ||
      extractDateLabel(clean(el.text())) ||
      undefined;
    const actTitle = clean(a.find("strong").first().text()) || clean(a.text()) || clean(el.find("strong").first().text());
    if (!actTitle || /no hi ha|sin actividades/i.test(actTitle)) return;
    activities.push({
      id: a.attr("data-id") || el.attr("data-id") || `act-${i}`,
      title: actTitle,
      date,
      dateIso: toIsoDate(date),
      description: clean(el.text()),
    });
  };
  $(".imc-avisos-modulo").each((_, mod) => {
    const title = clean($(mod).find("h2").first().text());
    if (title && !/activitat|actividad/i.test(title)) return;
    if ($(mod).find(".imc-sin-datos").length && !$(mod).find("ul li").length) return;
    $(mod).find("ul.imc-listado-detalle li, ul.imc-listado-agenda li").each((i, li) => pushLi(li, i));
  });
  if (activities.length) return uniqueBy(activities, (a) => `${a.id}:${a.title}:${a.date}`);
  $("ul.imc-listado-detalle li, ul.imc-listado-agenda li").each((i, li) => pushLi(li, i));
  return uniqueBy(activities, (a) => `${a.id}:${a.title}:${a.date}`);
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
  ctx?: { studentId?: string; studentName?: string },
): Notice | null {
  const el = $(li as never);
  const a = el.find("a").first().length ? el.find("a").first() : el;
  const rawText = clean(el.text());
  const dateLabel =
    clean(el.attr("data-date") || "") ||
    clean(a.find("span").first().text()) ||
    extractDateLabel(rawText) ||
    undefined;
  const title =
    clean(a.find("strong").first().text()) ||
    clean(rawText.replace(dateLabel || "", "")).replace(/^\s*[-–]\s*/, "") ||
    clean(a.text());
  if (!title || title.length < 3) return null;
  if (/entrar|login|contrasenya|contraseña|vore-les totes/i.test(title)) return null;
  const href = normalizeHref(a.attr("href") || a.attr("data-href") || "");
  const id = a.attr("data-id") || href.match(/agenda_id=(\d+)/i)?.[1] || `n-${i}`;
  return {
    id: String(id),
    date: dateLabel,
    dateIso: toIsoDate(dateLabel),
    title,
    body: title,
    unread: el.hasClass("imc-li-de-nuevo") || a.hasClass("imc-li-de-nuevo"),
    studentId: ctx?.studentId,
    studentName: ctx?.studentName,
    hasDetail: Boolean(
      (href && /alumno_avisos_wf|agenda_id/i.test(href)) ||
        (a.attr("data-id") && /^\d+$/.test(a.attr("data-id") || "")),
    ),
    detailHref: href && /alumno_avisos_wf|agenda_id/i.test(href) ? href : undefined,
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
