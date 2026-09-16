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
import { PlaywrightPdfSession } from "./playwright-pdf";
import { mockAllowed, passwordsMatch } from "./browser-session";
import { listCustomSlots } from "./custom-schedule";
import { loadDashboardCache, saveDashboardCache } from "./dashboard-cache";
import { listPhotoStudentIds, photoPublicUrl } from "./student-photos";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const BOOT_PATHS = [
  "listar_alumnos_wf",
  "main_wf",
];

const APP_VERSION = readAppVersion();

type RuntimeState = {
  mode: "mock" | "live";
  client: WebFamiliaClient | null;
  /** In-memory WF password for Playwright SharePoint downloads (never sent to client). */
  wfPassword?: string;
  lastLoginAt?: string;
  lastError?: string;
  lastDashboard?: Dashboard;
  captures: Record<string, string>;
  structure: StructureReport | null;
  autoLoginPromise?: Promise<Dashboard | null>;
  scrapeRunning: boolean;
  scrapeLastAt?: string;
  scrapeLastError?: string;
  cacheHydrated?: boolean;
};

const state: RuntimeState = {
  mode: "mock",
  client: null,
  captures: {},
  structure: null,
  scrapeRunning: false,
};

function readAppVersion() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function envScrapeConfigured() {
  const username = (process.env.WF_USER || process.env.PONT_WF_USER || "").trim();
  const password = process.env.WF_PASS || process.env.PONT_WF_PASS || "";
  return Boolean(username && password);
}

async function hydrateCacheOnce() {
  if (state.cacheHydrated) return;
  state.cacheHydrated = true;
  if (state.lastDashboard?.source === "live") return;
  try {
    const cached = await loadDashboardCache();
    if (cached) {
      state.lastDashboard = cached;
      state.mode = "live";
      state.lastLoginAt = cached.capturedAt;
      console.log(
        `[webfamilia] cache dashboard · students=${cached.students.length} · attachments=${cached.attachments?.length ?? 0}`,
      );
    }
  } catch (err) {
    console.error("[webfamilia] cache hydrate failed:", err);
  }
}

export async function getStatus(opts?: {
  browserAuth?: boolean;
  sessionMode?: "mock" | "live";
}): Promise<SessionStatus> {
  await hydrateCacheOnce();
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
          : wfLive || state.lastDashboard?.source === "live"
            ? "live"
            : "mock";
  const dash = state.lastDashboard;
  return {
    authenticated: browserAuth,
    mode: browserAuth ? mode : "mock",
    // Never leak full NIF to the client UI
    username: browserAuth ? maskLabel(state.client?.username ?? meta?.username) : undefined,
    hasStoredCredentials: await vaultExists(),
    vaultMode: meta?.mode,
    lastLoginAt: state.lastLoginAt ?? meta?.updatedAt,
    error: state.lastError || state.scrapeLastError,
    storage,
    allowMock: mockAllowed(),
    scrapeReady: Boolean(dash && dash.source === "live"),
    wfConnected: wfLive,
    version: APP_VERSION,
    scrape: {
      envConfigured: envScrapeConfigured(),
      running: state.scrapeRunning,
      lastAt: state.scrapeLastAt ?? dash?.capturedAt,
      lastError: state.scrapeLastError,
      attachments: dash?.attachments?.length ?? 0,
      menus: dash?.menus?.length ?? 0,
      notices: dash?.notices?.length ?? 0,
    },
  };
}

function maskLabel(username?: string) {
  if (!username) return undefined;
  const u = username.trim().toUpperCase();
  if (u.length <= 3) return "Compte desat";
  return `Compte ···${u.slice(-3)}`;
}

export function useMock() {
  state.mode = "mock";
  state.client = null;
  state.wfPassword = undefined;
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
    state.wfPassword = input.password;
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
      const partial: Dashboard = {
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
      state.lastDashboard = partial;
      state.lastError =
        dashError instanceof Error
          ? `Login OK, però el scrape parcial ha fallat: ${dashError.message}`
          : "Login OK, scrape parcial fallit";
      return mergeCustomIntoDashboard(partial);
    }
  } catch (error) {
    state.client = null;
    state.wfPassword = undefined;
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
    if (
      state.client?.isAuthenticated() &&
      state.client.username === creds.username &&
      state.lastDashboard?.source === "live"
    ) {
      state.wfPassword = creds.password;
      return mergeCustomIntoDashboard(state.lastDashboard);
    }
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
  if (
    state.client?.isAuthenticated() &&
    state.client.username === creds.username &&
    state.lastDashboard?.source === "live"
  ) {
    state.wfPassword = creds.password;
    return mergeCustomIntoDashboard(state.lastDashboard);
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

/** Server-side scrape using Railway WF_USER / WF_PASS (runs on boot). */
export async function tryEnvLogin(): Promise<Dashboard | null> {
  await hydrateCacheOnce();
  const username = (process.env.WF_USER || process.env.PONT_WF_USER || "").trim();
  const password = process.env.WF_PASS || process.env.PONT_WF_PASS || "";
  if (!username || !password) {
    const msg =
      "WF_USER/WF_PASS no configurats — el scrape d'arrencada no s'executa.";
    state.scrapeLastError = msg;
    console.warn(`[webfamilia] ${msg}`);
    return null;
  }
  if (state.client?.isAuthenticated() && state.client.username === username.toUpperCase()) {
    if (state.lastDashboard?.source === "live") return state.lastDashboard;
    state.scrapeRunning = true;
    try {
      const dash = await buildDashboard(state.client);
      state.scrapeLastAt = new Date().toISOString();
      state.scrapeLastError = undefined;
      return dash;
    } catch (error) {
      state.scrapeLastError = error instanceof Error ? error.message : "rescan fallit";
      console.error("[webfamilia] env rescan failed:", state.scrapeLastError);
      return state.lastDashboard ?? null;
    } finally {
      state.scrapeRunning = false;
    }
  }
  state.scrapeRunning = true;
  try {
    console.log(`[webfamilia] boot scrape · user=···${username.slice(-3)}`);
    // remember device vault so the phone gate can unlock against the same account
    const dash = await loginLive({
      username,
      password,
      remember: true,
      idioma: "V",
    });
    state.scrapeLastAt = new Date().toISOString();
    state.scrapeLastError = undefined;
    console.log(
      `[webfamilia] env scrape ok · students=${dash.students.length} · pdfs=${dash.attachments?.length ?? 0} · menus=${dash.menus?.length ?? 0}`,
    );
    return dash;
  } catch (error) {
    state.scrapeLastError = error instanceof Error ? error.message : "WF_USER login fallit";
    state.lastError = state.scrapeLastError;
    console.error("[webfamilia] env login failed:", state.scrapeLastError);
    return state.lastDashboard ?? null;
  } finally {
    state.scrapeRunning = false;
  }
}

let scrapeTimer: ReturnType<typeof setInterval> | null = null;

export function startBackgroundScrape() {
  const minutes = Number(process.env.PONT_SCRAPE_MINUTES || 45);
  void (async () => {
    await hydrateCacheOnce();
    const dash = await tryEnvLogin();
    if (!dash && !envScrapeConfigured()) {
      console.warn(
        "[webfamilia] Sense WF_USER+WF_PASS el servidor no pot scrapear PDFs a l'arrencada.",
      );
    }
  })();
  if (scrapeTimer || !Number.isFinite(minutes) || minutes <= 0) return;
  scrapeTimer = setInterval(() => {
    void (async () => {
      try {
        if (state.client?.isAuthenticated()) {
          state.scrapeRunning = true;
          await buildDashboard(state.client);
          state.scrapeLastAt = new Date().toISOString();
          state.scrapeLastError = undefined;
          state.scrapeRunning = false;
          console.log("[webfamilia] periodic rescan ok");
          return;
        }
        await tryEnvLogin();
      } catch (err) {
        state.scrapeRunning = false;
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
  state.wfPassword = undefined;
  state.mode = "mock";
  state.lastDashboard = undefined;
  state.lastLoginAt = undefined;
  state.lastError = undefined;
  state.captures = {};
  state.structure = null;
}

export async function getDashboard(opts?: { refresh?: boolean }): Promise<Dashboard> {
  if (state.mode === "mock" || !state.client) {
    const dash = state.lastDashboard ?? mockDashboard();
    return mergeCustomIntoDashboard(dash);
  }
  if (!opts?.refresh && state.lastDashboard?.source === "live") {
    return mergeCustomIntoDashboard(state.lastDashboard);
  }
  return buildDashboard(state.client);
}

export function getCachedDashboard() {
  return state.lastDashboard ?? null;
}

async function mergeCustomIntoDashboard(dash: Dashboard): Promise<Dashboard> {
  const custom = await listCustomSlots();
  const scraped = (dash.schedule ?? []).filter((s) => !s.custom);
  const schedule = mergeUnique(
    scraped,
    custom.map((s) => ({ ...s, custom: true as const })),
    (s) => `${s.studentId || ""}:${s.id}`,
  );
  const photoIds = new Set((await listPhotoStudentIds()).map((id) => String(id)));
  const students = dash.students.map((s) => {
    const id = String(s.id);
    return photoIds.has(id)
      ? { ...s, id, hasPhoto: true, photoUrl: photoPublicUrl(id) }
      : { ...s, id, hasPhoto: false, photoUrl: undefined };
  });
  const student =
    students.find((s) => s.id === String(dash.student?.id ?? "")) ??
    students[0] ??
    dash.student ??
    null;
  return { ...dash, schedule, students, student };
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
  const matriculaByStudent = new Map<string, string>();
  for (const mat of matriculaTargets.slice(0, 8)) {
    if (mat.matriculaId) matriculaByStudent.set(mat.alumnoId, mat.matriculaId);
    const student = students.find((s) => s.id === mat.alumnoId);
    const ctx = { studentId: mat.alumnoId, studentName: student?.name };
    const q =
      `alumno_id=${mat.alumnoId}` +
      (mat.matriculaId ? `&matricula_id=${mat.matriculaId}` : "");
    try {
      const matHref = mat.matriculaId
        ? `alumno_matricula_wf?${q}`
        : mat.href;
      const page = await client.get(matHref);
      if (/login_wf/i.test(page.url)) {
        scrapeErrors.push(`${matHref}: redirect login`);
        continue;
      }
      store(`st_${mat.alumnoId}_${captureKey(matHref)}`, page.html);
      if (student) {
        students = students.map((s) =>
          s.id === student.id ? enrichStudent(page.html, s) : s,
        );
      }

      const fetchTyped = async (href: string) => {
        const pageKey = `st_${mat.alumnoId}_${captureKey(href)}`;
        if (pages[pageKey]) return pages[pageKey];
        const sub = await client.get(href);
        if (/login_wf/i.test(sub.url)) return "";
        const $ = cheerio.load(sub.html);
        const fragment = $(".imc-contenido").first().html();
        const html =
          fragment ? `<div class="imc-contenido">${fragment}</div>${sub.html}` : sub.html;
        store(pageKey, html);
        return html;
      };

      // Parse each section ONLY from its own page (no cross-contamination)
      try {
        const agHtml = await fetchTyped(`alumno_avisos_wf?tipo=ag&${q}`);
        notices = mergeUnique(
          notices,
          parseNotices(agHtml, ctx),
          (n) => `${n.studentId || ""}:${n.id}:${n.title}`,
        );
      } catch (err) {
        scrapeErrors.push(`agenda ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
      try {
        const asHtml = await fetchTyped(`alumno_avisos_wf?tipo=as&${q}`);
        absences = mergeUnique(
          absences,
          tagStudent(parseAbsences(asHtml), ctx),
          (a) => `${a.studentId}:${a.id}:${a.date}`,
        );
      } catch (err) {
        scrapeErrors.push(`assist ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
      try {
        const acHtml = await fetchTyped(`alumno_avisos_wf?tipo=ac&${q}`);
        activities = mergeUnique(
          activities,
          tagStudent(parseActivities(acHtml), ctx),
          (a) => `${a.studentId}:${a.id}:${a.title}`,
        );
      } catch (err) {
        scrapeErrors.push(`activ ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
      try {
        const cmHtml = await fetchTyped(`alumno_avisos_wf?tipo=cm&cargado=true&${q}`);
        messages = mergeUnique(
          messages,
          tagStudent(parseMessages(cmHtml), ctx),
          (m) => `${m.studentId}:${m.id}:${m.subject}`,
        );
      } catch (err) {
        scrapeErrors.push(`com ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
      try {
        const gradesHtml = await fetchTyped(`alumno_calificaciones_wf?${q}`);
        grades = mergeUnique(
          grades,
          tagStudent(parseGrades(gradesHtml), ctx),
          (g) => `${g.studentId}:${g.id}:${g.subject}:${g.value}`,
        );
      } catch (err) {
        scrapeErrors.push(`notes ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
      try {
        const subjHtml = await fetchTyped(`alumno_materias_wf?${q}`);
        subjects = mergeUnique(
          subjects,
          tagStudent(parseSubjects(subjHtml), ctx),
          (s) => `${s.studentId}:${s.subject}`,
        );
      } catch (err) {
        scrapeErrors.push(`mat ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
      try {
        const horHtml = await fetchTyped(`alumno_horarios_wf?${q}`);
        schedule = mergeUnique(
          schedule,
          tagStudent(parseSchedule(horHtml), ctx).map((s, i) => ({
            ...s,
            id: `${ctx.studentId}-${s.id}-${i}`,
          })),
          (s) => `${s.studentId}:${s.day}:${s.start}:${s.subject}`,
        );
      } catch (err) {
        scrapeErrors.push(`horari ${mat.alumnoId}: ${err instanceof Error ? err.message : "error"}`);
      }
    } catch (err) {
      scrapeErrors.push(`${mat.href}: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  // Open aviso details and pull PDFs (Agenda → PDF → Menús) — per student
  // SharePoint needs Playwright (browser cookies); cheerio/fetch alone fails.
  const pdfCache = new Map<string, { att: Attachment; buffer: Buffer }>();
  let pw: PlaywrightPdfSession | null = null;
  const ensurePw = async () => {
    if (pw) return pw;
    const password = await resolveWfPassword(client);
    if (!password || !client.username) return null;
    try {
      pw = new PlaywrightPdfSession();
      await pw.start(client.username, password);
      return pw;
    } catch (err) {
      scrapeErrors.push(
        `playwright login: ${err instanceof Error ? err.message : "error"}`,
      );
      await pw?.close().catch(() => undefined);
      pw = null;
      return null;
    }
  };
  try {
  for (const notice of notices.slice(0, 50)) {
    const mid = notice.studentId ? matriculaByStudent.get(notice.studentId) : undefined;
    const hrefCandidates = [
      notice.detailHref,
      notice.id && /^\d+$/.test(notice.id)
        ? `alumno_avisos_wf?tipo=ag&agenda_id=${notice.id}${notice.studentId ? `&alumno_id=${notice.studentId}` : ""}${mid ? `&matricula_id=${mid}` : ""}`
        : "",
      notice.id && /^\d+$/.test(notice.id) ? `alumno_avisos_wf?tipo=ag&agenda_id=${notice.id}` : "",
    ].filter(Boolean) as string[];
    if (!hrefCandidates.length && !notice.hasDetail) continue;
    let detailHtml = "";
    let detailUrl = "";
    for (const href of hrefCandidates) {
      try {
        const detail = await client.get(href);
        if (/login_wf/i.test(detail.url)) continue;
        detailHtml = detail.html;
        detailUrl = detail.url;
        store(`detail_${notice.studentId || "x"}_${captureKey(href)}`, detail.html);
        break;
      } catch (err) {
        scrapeErrors.push(`detail ${href}: ${err instanceof Error ? err.message : "error"}`);
      }
    }
    if (!detailHtml) continue;
    const docLinks = parseDocumentLinks(detailHtml, detailUrl || "https://familia.edu.gva.es");
    if (!docLinks.length) {
      scrapeErrors.push(`sense PDF: ${notice.title.slice(0, 40)} (${notice.studentId || "?"})`);
    }
    notice.attachments = notice.attachments || [];
    const tryStorePdf = async (
      buffer: Buffer,
      url: string,
      filenameHint: string | undefined,
      docText: string,
    ) => {
      const filename = (
        docText.match(/[\w.\- ]+\.pdf/i)?.[0] ||
        filenameHint ||
        `${notice.title}.pdf`
      )
        .replace(/[^\w.\- ]+/g, "_")
        .slice(0, 80);
      const safeName = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      const hash = shaOf(buffer);
      const cached = pdfCache.get(hash);
      let att: Attachment;
      if (cached) {
        att = { ...cached.att, studentId: notice.studentId, noticeId: notice.id };
      } else {
        att = await storePdf({
          buffer,
          filename: safeName,
          sourceUrl: url,
          title: notice.title,
          noticeId: notice.id,
          studentId: notice.studentId,
        });
        pdfCache.set(att.sha256, { att, buffer });
        if (!seenPdf.has(att.sha256)) {
          seenPdf.add(att.sha256);
          attachments.push(att);
        }
      }
      if (!notice.attachments!.some((a) => a.sha256 === att.sha256)) {
        notice.attachments!.push(att);
      }
      const looksMenu =
        att.kind === "menu_menjador" ||
        att.kind === "menu_especial" ||
        /men[uú]|menjador|comedor|dieta/i.test(`${att.filename} ${notice.title} ${docText}`);
      if (looksMenu) {
        const already = menus.some(
          (m) => m.attachmentId === att.id && m.studentId === notice.studentId,
        );
        if (!already) {
          try {
            const buf = cached?.buffer ?? buffer;
            const menu = await extractMenuFromPdf(buf, {
              sourceFile: att.filename,
              centerName: students.find((s) => s.id === notice.studentId)?.center,
            });
            if (menu) {
              menu.attachmentId = att.id;
              menu.studentId = notice.studentId;
              menu.studentName = notice.studentName;
              menus.push(menu);
            } else scrapeErrors.push(`menu buit: ${att.filename}`);
          } catch (err) {
            scrapeErrors.push(
              `menu ${att.filename}: ${err instanceof Error ? err.message : "error"}`,
            );
          }
        }
      }
    };

    for (const doc of docLinks.slice(0, 10)) {
      try {
        let resolved = await downloadPdfSmart(client, doc.href, detailUrl);
        if (!resolved) {
          const session = await ensurePw();
          if (session) {
            resolved = await session.downloadFromDetail({
              detailUrl:
                detailUrl.startsWith("http")
                  ? detailUrl
                  : `https://familia.edu.gva.es/wf-front/myitaca/${detailUrl.replace(/^\//, "")}`,
              linkHref: doc.href,
              linkText: doc.text,
              noticeTitle: notice.title,
            });
          }
        }
        if (!resolved) continue;
        await tryStorePdf(resolved.buffer, resolved.url, resolved.filenameHint, doc.text);
      } catch (err) {
        scrapeErrors.push(`pdf ${doc.href}: ${err instanceof Error ? err.message : "error"}`);
      }
    }

    // No doc links or download failed: Playwright click on notice title (SharePoint path)
    if (!notice.attachments.length && /men[uú]|menjador|pdf|document|adjunt/i.test(notice.title)) {
      try {
        const session = await ensurePw();
        if (session && detailUrl) {
          const absolute =
            detailUrl.startsWith("http")
              ? detailUrl
              : `https://familia.edu.gva.es/wf-front/myitaca/${detailUrl.replace(/^\//, "")}`;
          const captured = await session.downloadFromDetail({
            detailUrl: absolute,
            noticeTitle: notice.title,
          });
          if (captured) {
            await tryStorePdf(
              captured.buffer,
              captured.url,
              captured.filenameHint,
              notice.title,
            );
          }
        }
      } catch (err) {
        scrapeErrors.push(
          `playwright ${notice.title.slice(0, 30)}: ${err instanceof Error ? err.message : "error"}`,
        );
      }
    }
    if (notice.attachments.length) notice.body = notice.title;
  }

  // Dedicated Menú menjador pass if still empty
  if (!menus.length) {
    try {
      const session = await ensurePw();
      if (session) {
        const captured = await session.downloadByNoticeTitle(/Men[uú]\s+menjador/i);
        if (captured) {
          const att = await storePdf({
            buffer: captured.buffer,
            filename: captured.filenameHint || "menu-menjador.pdf",
            sourceUrl: captured.url,
            title: "Menú menjador",
            studentId: students[0]?.id,
          });
          if (!seenPdf.has(att.sha256)) {
            seenPdf.add(att.sha256);
            attachments.push(att);
          }
          const menu = await extractMenuFromPdf(captured.buffer, {
            sourceFile: att.filename,
            centerName: students[0]?.center,
          });
          if (menu) {
            menu.attachmentId = att.id;
            menu.studentId = students[0]?.id;
            menu.studentName = students[0]?.name;
            menus.push(menu);
          }
        }
      }
    } catch (err) {
      scrapeErrors.push(
        `playwright menú: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }
  } finally {
    if (pw) await pw.close().catch(() => undefined);
  }

  state.structure = analyzePages(pages);
  const behaviors = parseBehaviors(homeHtml);
  const customSlots = await listCustomSlots();
  schedule = mergeUnique(
    schedule,
    customSlots.map((s) => ({ ...s, custom: true })),
    (s) => `${s.studentId}:${s.id}`,
  );

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
  void saveDashboardCache(dashboard).catch((err) =>
    console.error("[webfamilia] dashboard cache save failed:", err),
  );
  // Re-attach Postgres photos + custom slots after every scrape/login.
  return mergeCustomIntoDashboard(dashboard);
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

function shaOf(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

async function resolveWfPassword(client: WebFamiliaClient): Promise<string | null> {
  if (state.wfPassword) return state.wfPassword;
  const envPass = process.env.WF_PASS || process.env.PONT_WF_PASS || "";
  const envUser = (process.env.WF_USER || process.env.PONT_WF_USER || "").trim().toUpperCase();
  if (envPass && (!envUser || envUser === client.username)) return envPass;
  try {
    const creds = await loadCredentials();
    if (creds.username === client.username) {
      state.wfPassword = creds.password;
      return creds.password;
    }
  } catch {
    // vault locked or missing
  }
  return null;
}

/** Download a PDF; if the URL returns an HTML viewer, dig for nested PDF links. */
async function downloadPdfSmart(
  client: WebFamiliaClient,
  href: string,
  refererUrl: string,
): Promise<{ buffer: Buffer; url: string; filenameHint?: string } | null> {
  const file = await client.getBinary(href);
  const isPdf =
    /pdf/i.test(file.contentType) ||
    /\.pdf(\?|$)/i.test(file.url) ||
    file.buffer.slice(0, 4).toString() === "%PDF";
  if (isPdf && file.buffer.length >= 100) {
    return {
      buffer: file.buffer,
      url: file.url,
      filenameHint: file.url.split("/").pop()?.split("?")[0],
    };
  }
  // HTML wrapper / visor: parse again
  const asText = file.buffer.toString("latin1");
  if (!/<html|<body|documento|pdf/i.test(asText)) return null;
  const nested = parseDocumentLinks(asText, refererUrl || file.url);
  for (const n of nested.slice(0, 5)) {
    if (n.href === href) continue;
    try {
      const inner = await client.getBinary(n.href);
      const ok =
        /pdf/i.test(inner.contentType) ||
        /\.pdf(\?|$)/i.test(inner.url) ||
        inner.buffer.slice(0, 4).toString() === "%PDF";
      if (ok && inner.buffer.length >= 100) {
        return {
          buffer: inner.buffer,
          url: inner.url,
          filenameHint: n.text.match(/[\w.\- ]+\.pdf/i)?.[0] || inner.url.split("/").pop(),
        };
      }
    } catch {
      // try next
    }
  }
  return null;
}
