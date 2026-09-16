import {
  parseAbsences,
  parseActivities,
  parseBehaviors,
  parseDocumentLinks,
  parseGrades,
  parseMatriculaLinks,
  parseMessages,
  parseNotices,
  parseSchedule,
  parseSectionTargets,
  parseStudents,
  parseSubjects,
  enrichStudent,
} from "./parsers";
import { mockDashboard } from "./mock";
import { extractNavLinks, WebFamiliaClient } from "./webfamilia";
import type { Attachment, Dashboard, MenuExtraction, Notice, SessionStatus } from "@pont/shared";
import {
  clearCredentials,
  getStorageInfo,
  loadCredentials,
  peekVaultMeta,
  saveCredentials,
  vaultExists,
} from "./vault";
import { analyzePages, type StructureReport } from "./structure";
import { storePdf } from "./attachments";
import { extractMenuFromPdf } from "./menu-pdf";
import { mockAllowed, passwordsMatch } from "./browser-session";
import * as cheerio from "cheerio";

const BOOT_PATHS = [
  "listar_alumnos_wf",
  "main_wf",
];

type RuntimeState = {
  mode: "mock" | "live";
  client: WebFamiliaClient | null;
  lastLoginAt?: string;
  lastError?: string;
  lastDashboard?: Dashboard;
  captures: Record<string, string>;
  structure: StructureReport | null;
  autoLoginPromise?: Promise<Dashboard | null>;
};

const state: RuntimeState = {
  mode: "mock",
  client: null,
  captures: {},
  structure: null,
};

export async function getStatus(opts?: {
  browserAuth?: boolean;
  sessionMode?: "mock" | "live";
}): Promise<SessionStatus> {
  const meta = await peekVaultMeta();
  const storage = getStorageInfo();
  const browserAuth = Boolean(opts?.browserAuth);
  const wfLive = state.mode === "live" && Boolean(state.client?.isAuthenticated());
  const mode =
    browserAuth && opts?.sessionMode === "mock"
      ? "mock"
      : browserAuth && wfLive
        ? "live"
        : browserAuth && state.lastDashboard?.source === "mock"
          ? "mock"
          : wfLive
            ? "live"
            : "mock";
  return {
    authenticated: browserAuth,
    mode: browserAuth ? mode : "mock",
    username: state.client?.username ?? meta?.username,
    hasStoredCredentials: await vaultExists(),
    vaultMode: meta?.mode,
    lastLoginAt: state.lastLoginAt ?? meta?.updatedAt,
    error: state.lastError,
    storage,
    allowMock: mockAllowed(),
    scrapeReady: Boolean(state.lastDashboard && state.lastDashboard.source === "live"),
    wfConnected: wfLive,
  };
}

export function useMock() {
  state.mode = "mock";
  state.client = null;
  state.lastError = undefined;
  state.lastDashboard = mockDashboard();
  return state.lastDashboard;
}

export async function loginLive(input: {
  username: string;
  password: string;
  remember?: boolean;
  protectWithMaster?: boolean;
  masterPassword?: string;
  idioma?: "V" | "C";
}) {
  const client = new WebFamiliaClient();
  try {
    const page = await client.login(input.username, input.password, input.idioma ?? "V");
    state.client = client;
    state.mode = "live";
    state.lastLoginAt = new Date().toISOString();
    state.lastError = undefined;
    state.captures = { main: page.html };
    if (input.remember !== false) {
      const mode = input.protectWithMaster ? "master" : "device";
      await saveCredentials(
        { username: input.username.trim().toUpperCase(), password: input.password },
        { mode, masterPassword: input.masterPassword },
      );
    }
    try {
      return await buildDashboard(client);
    } catch (dashError) {
      const students = parseStudents(page.html);
      const dashboard: Dashboard = {
        source: "live",
        capturedAt: new Date().toISOString(),
        students,
        student: students[0] ?? {
          id: "1",
          name: input.username.trim().toUpperCase(),
        },
        notices: parseNotices(page.html),
        absences: [],
        grades: [],
        messages: [],
        activities: [],
        behaviors: [],
        subjects: [],
        schedule: [],
        attachments: [],
        menus: [],
        diagnostics: {
          pages: [{ key: "main", bytes: page.html.length, title: page.title }],
          navLinks: extractNavLinks(page.html).slice(0, 40),
          scrapeErrors: [
            dashError instanceof Error ? dashError.message : "scrape parcial fallit",
          ],
          note: "Login OK, però el scrape parcial ha fallat.",
        },
      };
      state.lastDashboard = dashboard;
      state.lastError =
        dashError instanceof Error
          ? `Login OK, però el scrape parcial ha fallat: ${dashError.message}`
          : "Login OK, scrape parcial fallit";
      return dashboard;
    }
  } catch (error) {
    state.client = null;
    state.mode = "mock";
    state.lastError = error instanceof Error ? error.message : "Error de login";
    throw error;
  }
}

export async function unlockAndLogin(input: {
  masterPassword?: string;
  password?: string;
}) {
  const meta = await peekVaultMeta();
  if (!meta) throw new Error("No hi ha credencials desades.");
  if (meta.mode === "master") {
    if (!input.masterPassword) {
      throw new Error("Cal la contrasenya mestra per desbloquejar.");
    }
    const creds = await loadCredentials(input.masterPassword);
    return loginLive({
      username: creds.username,
      password: creds.password,
      remember: false,
    });
  }
  // device vault: require Web Família password (never unlock anonymously)
  const creds = await loadCredentials();
  if (!input.password || !passwordsMatch(input.password, creds.password)) {
    throw new Error(
      "Cal la contrasenya de Web Família per obrir la sessió en aquest navegador.",
    );
  }
  return loginLive({
    username: creds.username,
    password: creds.password,
    remember: false,
  });
}

/** @deprecated anonymous auto-login removed for security */
export async function tryAutoLogin(): Promise<Dashboard | null> {
  return null;
}

/** Server-side scrape using Railway WF_USER / WF_PASS (no browser session). */
export async function tryEnvLogin(): Promise<Dashboard | null> {
  const username = (process.env.WF_USER || process.env.PONT_WF_USER || "").trim();
  const password = process.env.WF_PASS || process.env.PONT_WF_PASS || "";
  if (!username || !password) return null;
  if (state.client?.isAuthenticated() && state.client.username === username.toUpperCase()) {
    return state.lastDashboard ?? (await buildDashboard(state.client));
  }
  try {
    return await loginLive({
      username,
      password,
      remember: false,
      idioma: "V",
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "WF_USER login fallit";
    console.error("[webfamilia] env login failed:", state.lastError);
    return null;
  }
}

let scrapeTimer: ReturnType<typeof setInterval> | null = null;

export function startBackgroundScrape() {
  const minutes = Number(process.env.PONT_SCRAPE_MINUTES || 45);
  void tryEnvLogin().then((dash) => {
    if (dash) console.log(`[webfamilia] env scrape ok · students=${dash.students.length}`);
  });
  if (scrapeTimer || !Number.isFinite(minutes) || minutes <= 0) return;
  scrapeTimer = setInterval(() => {
    void (async () => {
      try {
        if (state.client?.isAuthenticated()) {
          await buildDashboard(state.client);
          console.log("[webfamilia] periodic rescan ok");
          return;
        }
        await tryEnvLogin();
      } catch (err) {
        console.error("[webfamilia] periodic scrape failed", err);
      }
    })();
  }, minutes * 60 * 1000);
  if (typeof scrapeTimer === "object" && scrapeTimer && "unref" in scrapeTimer) {
    scrapeTimer.unref?.();
  }
}

export async function forgetCredentials() {
  await clearCredentials();
  state.client = null;
  state.mode = "mock";
  state.lastDashboard = undefined;
  state.lastLoginAt = undefined;
  state.lastError = undefined;
  state.captures = {};
  state.structure = null;
}

export async function getDashboard(opts?: { refresh?: boolean }): Promise<Dashboard> {
  if (state.mode === "mock" || !state.client) {
    return state.lastDashboard ?? mockDashboard();
  }
  if (!opts?.refresh && state.lastDashboard?.source === "live") {
    return state.lastDashboard;
  }
  return buildDashboard(state.client);
}

export function getCachedDashboard() {
  return state.lastDashboard ?? null;
}

export function getCaptures() {
  return Object.fromEntries(
    Object.entries(state.captures).map(([key, html]) => [
      key,
      {
        bytes: html.length,
        preview: redactSensitive(html).slice(0, 400),
        markers: summarizeMarkers(html),
      },
    ]),
  );
}

export function getCaptureHtml(key: string) {
  const html = state.captures[key];
  return html ? redactSensitive(html) : null;
}

export function getStructureReport() {
  return state.structure;
}

/** Force a live rescan and return dashboard + structure for admin UI. */
export async function rescanLive() {
  if (!state.client?.isAuthenticated()) {
    throw new Error("Cal una sessió en viu per rescannejar.");
  }
  const dashboard = await buildDashboard(state.client);
  return { dashboard, structure: state.structure, captures: getCaptures() };
}

async function buildDashboard(client: WebFamiliaClient): Promise<Dashboard> {
  const pages: Record<string, string> = {};
  const scrapeErrors: string[] = [];
  state.captures = {};
  state.structure = null;

  const store = (key: string, html: string) => {
    pages[key] = html;
    state.captures[key] = html;
  };

  if (client.lastHtml) store("main", client.lastHtml);

  for (const boot of BOOT_PATHS) {
    try {
      const page = await client.get(boot, { ajax: false });
      if (/login_wf/i.test(page.url)) {
        scrapeErrors.push(`${boot}: redirect login`);
        continue;
      }
      store(captureKey(boot), page.html);
      if (/listar_alumnos_wf|imc-alumno-nombre|imc-alumnos/i.test(page.html)) break;
    } catch (err) {
      scrapeErrors.push(`${boot}: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  const homeHtml =
    Object.entries(pages).find(([k]) => /listar_alumnos/i.test(k))?.[1] ||
    pages.main ||
    client.lastHtml ||
    "";

  let students = parseStudents(homeHtml);
  const matriculas = parseMatriculaLinks(homeHtml);
  const nav = extractNavLinks(homeHtml);
  const attachments: Attachment[] = [];
  const menus: MenuExtraction[] = [];
  const seenPdf = new Set<string>();
  let notices: Notice[] = [];
  let absences: Dashboard["absences"] = [];
  let grades: Dashboard["grades"] = [];
  let messages: Dashboard["messages"] = [];
  let activities: Dashboard["activities"] = [];
  let subjects: Dashboard["subjects"] = [];
  let schedule: Dashboard["schedule"] = [];

  for (const student of students.slice(0, 8)) {
    try {
      const datos = await client.get(`alumno_datos_wf?alumno_id=${student.id}`);
      if (!/login_wf/i.test(datos.url)) {
        store(`alumno_datos_${student.id}`, datos.html);
        students = students.map((s) =>
          s.id === student.id ? enrichStudent(datos.html, s) : s,
        );
      }
    } catch (err) {
      scrapeErrors.push(
        `alumno_datos_${student.id}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  const matriculaTargets = matriculas.length
    ? matriculas
    : students.flatMap((s) =>
        s.id
          ? [
              {
                alumnoId: s.id,
                matriculaId: "",
                href: `alumno_datos_wf?alumno_id=${s.id}`,
                label: s.name,
              },
            ]
          : [],
      );

  // Scrape EACH student fully on the server (not only the active UI tab)
  for (const mat of matriculaTargets.slice(0, 8)) {
    const student = students.find((s) => s.id === mat.alumnoId);
    const ctx = { studentId: mat.alumnoId, studentName: student?.name };
    const studentPages: string[] = [];
    try {
      const matHref =
        mat.matriculaId
          ? `alumno_matricula_wf?alumno_id=${mat.alumnoId}&matricula_id=${mat.matriculaId}`
          : mat.href;
      const page = await client.get(matHref);
      if (/login_wf/i.test(page.url)) {
        scrapeErrors.push(`${matHref}: redirect login`);
        continue;
      }
      store(`st_${mat.alumnoId}_${captureKey(matHref)}`, page.html);
      studentPages.push(page.html);
      if (student) {
        students = students.map((s) =>
          s.id === student.id ? enrichStudent(page.html, s) : s,
        );
      }
      const sections = parseSectionTargets(page.html);
      const extras = [
        ...sections.map((s) => s.href),
        `alumno_avisos_wf?tipo=ag&alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
        `alumno_avisos_wf?tipo=as&alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
        `alumno_avisos_wf?tipo=ac&alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
        `alumno_avisos_wf?tipo=cm&cargado=true&alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
        `alumno_calificaciones_wf?alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
        `alumno_materias_wf?alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
        `alumno_horarios_wf?alumno_id=${mat.alumnoId}${mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : ""}`,
      ];
      for (const href of unique(extras).slice(0, 24)) {
        const pageKey = `st_${mat.alumnoId}_${captureKey(href)}`;
        if (!href || pages[pageKey]) continue;
        try {
          const sub = await client.get(href);
          if (/login_wf/i.test(sub.url)) continue;
          const $ = cheerio.load(sub.html);
          const fragment = $(".imc-contenido").first().html();
          const html =
            fragment ? `<div class="imc-contenido">${fragment}</div>${sub.html}` : sub.html;
          store(pageKey, html);
          studentPages.push(html);
        } catch (err) {
          scrapeErrors.push(`${href}: ${err instanceof Error ? err.message : "error"}`);
        }
      }

      const blob = studentPages.join("\n");
      notices = mergeUnique(
        notices,
        parseNotices(blob, ctx),
        (n) => `${n.studentId || ""}:${n.id}:${n.title}`,
      );
      absences = mergeUnique(
        absences,
        tagStudent(parseAbsences(blob), ctx),
        (a) => `${a.studentId}:${a.id}:${a.date}`,
      );
      grades = mergeUnique(
        grades,
        tagStudent(parseGrades(blob), ctx),
        (g) => `${g.studentId}:${g.id}:${g.subject}:${g.value}`,
      );
      messages = mergeUnique(
        messages,
        tagStudent(parseMessages(blob), ctx),
        (m) => `${m.studentId}:${m.id}:${m.subject}`,
      );
      activities = mergeUnique(
        activities,
        tagStudent(parseActivities(blob), ctx),
        (a) => `${a.studentId}:${a.id}:${a.title}`,
      );
      subjects = mergeUnique(
        subjects,
        tagStudent(parseSubjects(blob), ctx),
        (s) => `${s.studentId}:${s.subject}`,
      );
      schedule = mergeUnique(
        schedule,
        tagStudent(parseSchedule(blob), ctx).map((s, i) => ({
          ...s,
          id: `${ctx.studentId}-${s.id}-${i}`,
        })),
        (s) => `${s.studentId}:${s.day}:${s.start}:${s.subject}`,
      );
    } catch (err) {
      scrapeErrors.push(`${mat.href}: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  // Open aviso details and pull PDFs (Agenda → PDF)
  for (const notice of notices.slice(0, 28)) {
    if (!notice.detailHref && !notice.hasDetail) continue;
    const detailHref =
      notice.detailHref ||
      `alumno_avisos_wf?tipo=ag&agenda_id=${notice.id}${notice.studentId ? `&alumno_id=${notice.studentId}` : ""}`;
    try {
      const detail = await client.get(detailHref);
      if (/login_wf/i.test(detail.url)) continue;
      store(`detail_${notice.studentId || "x"}_${captureKey(detailHref)}`, detail.html);
      const docLinks = parseDocumentLinks(detail.html, detail.url);
      for (const doc of docLinks.slice(0, 6)) {
        try {
          const file = await client.getBinary(doc.href);
          const isPdf =
            /pdf/i.test(file.contentType) ||
            /\.pdf(\?|$)/i.test(file.url) ||
            file.buffer.slice(0, 4).toString() === "%PDF";
          if (!isPdf || file.buffer.length < 100) continue;
          const filename =
            doc.text.replace(/[^\w.\- ]+/g, "_").slice(0, 80) ||
            file.url.split("/").pop()?.split("?")[0] ||
            `${notice.title}.pdf`;
          const att = await storePdf({
            buffer: file.buffer,
            filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
            sourceUrl: file.url,
            title: notice.title,
            noticeId: notice.id,
            studentId: notice.studentId,
          });
          if (seenPdf.has(att.sha256)) {
            notice.attachments = [...(notice.attachments || []), att];
            // still attach menu tag for this student if shared PDF
            const existing = menus.find((m) => m.attachmentId === att.id);
            if (existing && notice.studentId && !existing.studentId) {
              existing.studentId = notice.studentId;
              existing.studentName = notice.studentName;
            }
            continue;
          }
          seenPdf.add(att.sha256);
          attachments.push(att);
          notice.attachments = [...(notice.attachments || []), att];
          const looksMenu =
            att.kind === "menu_menjador" ||
            att.kind === "menu_especial" ||
            /men[uú]|menjador|comedor/i.test(att.filename + " " + notice.title + " " + doc.text);
          if (looksMenu) {
            try {
              const menu = await extractMenuFromPdf(file.buffer, {
                sourceFile: att.filename,
                centerName: students.find((s) => s.id === notice.studentId)?.center,
              });
              if (menu) {
                menu.attachmentId = att.id;
                menu.studentId = notice.studentId;
                menu.studentName = notice.studentName;
                menus.push(menu);
              }
            } catch (err) {
              scrapeErrors.push(
                `menu ${att.filename}: ${err instanceof Error ? err.message : "error"}`,
              );
            }
          }
        } catch (err) {
          scrapeErrors.push(
            `pdf ${doc.href}: ${err instanceof Error ? err.message : "error"}`,
          );
        }
      }
    } catch (err) {
      scrapeErrors.push(
        `detail ${detailHref}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  state.structure = analyzePages(pages);
  const behaviors = parseBehaviors(homeHtml);

  const scrapedStudents = students.map((s) => ({
    id: s.id,
    name: s.name,
    notices: notices.filter((n) => n.studentId === s.id).length,
    schedule: schedule.filter((h) => h.studentId === s.id).length,
    subjects: subjects.filter((x) => x.studentId === s.id).length,
    absences: absences.filter((a) => a.studentId === s.id).length,
    menus: menus.filter((m) => m.studentId === s.id).length,
    tutorName: s.tutorName,
    group: s.group || s.course,
  }));

  const diagnostics = {
    pages: Object.entries(pages).map(([key, html]) => ({
      key,
      bytes: html.length,
      title: cheerio.load(html)("title").first().text().replace(/\s+/g, " ").trim(),
      links: extractNavLinks(html).length,
    })),
    navLinks: nav.slice(0, 40),
    scrapeErrors: scrapeErrors.slice(0, 30),
    scrapedStudents,
    note:
      notices.length +
        absences.length +
        grades.length +
        messages.length +
        activities.length +
        schedule.length +
        subjects.length ===
      0
        ? "S'ha capturat HTML però els parsers no han trobat files. Usa Admin → Rescanejar."
        : undefined,
  };

  const dashboard: Dashboard = {
    source: "live",
    capturedAt: new Date().toISOString(),
    students,
    student: students[0] ?? null,
    notices,
    absences,
    grades,
    messages,
    activities,
    behaviors,
    subjects,
    schedule,
    attachments,
    menus,
    diagnostics,
  };
  state.lastDashboard = dashboard;
  return dashboard;
}

function tagStudent<T extends object>(
  items: T[],
  ctx: { studentId: string; studentName?: string },
): (T & { studentId: string; studentName?: string })[] {
  return items.map((item) => ({ ...item, studentId: ctx.studentId, studentName: ctx.studentName }));
}

function captureKey(href: string) {
  return href
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^.*\//, "")
    .replace(/[?&=]/g, "_")
    .slice(0, 120) || "page";
}

function mergeUnique<T>(a: T[], b: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...a, ...b]) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function unique(items: string[]) {
  return [...new Set(items.map((i) => i.replace(/^\.\//, "").trim()).filter(Boolean))];
}

function redactSensitive(html: string) {
  return html
    .replace(
      /(name=["']tokenSesion["'][^>]*value=["'])[^"']*(["'])/gi,
      "$1[redacted]$2",
    )
    .replace(
      /(id=["']tokenSesion["'][^>]*value=["'])[^"']*(["'])/gi,
      "$1[redacted]$2",
    )
    .replace(
      /(Contrasenya inicial[\s\S]*?<li>)[^<]+(<\/li>)/gi,
      "$1[redacted]$2",
    )
    .replace(
      /(Clau recuperaci[oó][\s\S]*?<li>)[^<]+(<\/li>)/gi,
      "$1[redacted]$2",
    );
}

function summarizeMarkers(html: string) {
  const markers = [
    "imc-alumno-nombre",
    "imc-listado-agenda",
    "imc-avisos-modulo",
    "imc-horarios",
    "imc-materias-tabla",
    "imc-matricula-menu",
    "imc-form-login",
    "imc-sesion-caducada",
  ];
  return markers.filter((m) => html.includes(m));
}
