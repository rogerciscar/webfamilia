import {
  parseAbsences,
  parseActivities,
  parseBehaviors,
  parseGrades,
  parseMatriculaLinks,
  parseMessages,
  parseNotices,
  parseSchedule,
  parseSectionTargets,
  parseStudents,
  parseSubjects,
  pageScore,
} from "./parsers";
import { mockDashboard } from "./mock";
import { extractNavLinks, WebFamiliaClient } from "./webfamilia";
import type { Dashboard, SessionStatus } from "@pont/shared";
import {
  clearCredentials,
  getStorageInfo,
  loadCredentials,
  peekVaultMeta,
  saveCredentials,
  vaultExists,
} from "./vault";
import * as cheerio from "cheerio";

const BOOT_PATHS = [
  "listar_alumnos_wf",
  "main_wf",
  "alumno_avisos_wf?tipo=cm&cargado=true",
];

type RuntimeState = {
  mode: "mock" | "live";
  client: WebFamiliaClient | null;
  lastLoginAt?: string;
  lastError?: string;
  lastDashboard?: Dashboard;
  captures: Record<string, string>;
  autoLoginPromise?: Promise<Dashboard | null>;
};

const state: RuntimeState = {
  mode: "mock",
  client: null,
  captures: {},
};

export async function getStatus(): Promise<SessionStatus> {
  const meta = await peekVaultMeta();
  const storage = getStorageInfo();
  return {
    authenticated: state.mode === "live" && Boolean(state.client?.isAuthenticated()),
    mode: state.mode,
    username: state.client?.username ?? meta?.username,
    hasStoredCredentials: await vaultExists(),
    vaultMode: meta?.mode,
    lastLoginAt: state.lastLoginAt ?? meta?.updatedAt,
    error: state.lastError,
    storage,
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

export async function unlockAndLogin(masterPassword?: string) {
  const meta = await peekVaultMeta();
  if (!meta) throw new Error("No hi ha credencials desades.");
  if (meta.mode === "master" && !masterPassword) {
    throw new Error("Cal la contrasenya mestra per desbloquejar.");
  }
  const creds = await loadCredentials(masterPassword);
  return loginLive({
    username: creds.username,
    password: creds.password,
    remember: false,
  });
}

/** Auto-login when vault is device-bound. Safe no-op otherwise. */
export async function tryAutoLogin(): Promise<Dashboard | null> {
  if (state.client?.isAuthenticated()) {
    return state.lastDashboard ?? (await getDashboard());
  }
  if (state.autoLoginPromise) return state.autoLoginPromise;
  state.autoLoginPromise = (async () => {
    try {
      const meta = await peekVaultMeta();
      if (!meta || meta.mode !== "device") return null;
      return await unlockAndLogin();
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "Auto-login fallit";
      return null;
    } finally {
      state.autoLoginPromise = undefined;
    }
  })();
  return state.autoLoginPromise;
}

export async function forgetCredentials() {
  await clearCredentials();
  state.client = null;
  state.mode = "mock";
  state.lastDashboard = undefined;
  state.lastLoginAt = undefined;
  state.lastError = undefined;
  state.captures = {};
}

export async function getDashboard(): Promise<Dashboard> {
  if (state.mode === "mock" || !state.client) {
    return state.lastDashboard ?? mockDashboard();
  }
  return buildDashboard(state.client);
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

async function buildDashboard(client: WebFamiliaClient): Promise<Dashboard> {
  const pages: Record<string, string> = {};
  const scrapeErrors: string[] = [];
  state.captures = {};

  const store = (key: string, html: string) => {
    pages[key] = html;
    state.captures[key] = html;
  };

  if (client.lastHtml) store("main", client.lastHtml);

  // Always land on the real home: listar_alumnos_wf
  for (const boot of BOOT_PATHS) {
    try {
      const page = await client.get(boot);
      if (/login_wf/i.test(page.url)) {
        scrapeErrors.push(`${boot}: redirect login`);
        continue;
      }
      store(captureKey(boot), page.html);
      if (/listar_alumnos_wf|imc-alumno-nombre|imc-alumnos/i.test(page.html)) break;
    } catch (err) {
      scrapeErrors.push(
        `${boot}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  const homeHtml =
    Object.entries(pages).find(([k]) => /listar_alumnos/i.test(k))?.[1] ||
    pages.main ||
    client.lastHtml ||
    "";

  const students = parseStudents(homeHtml);
  const matriculas = parseMatriculaLinks(homeHtml);
  const nav = extractNavLinks(homeHtml);

  // Prefer first student's matriculas; also scrape siblings lightly
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

  for (const mat of matriculaTargets.slice(0, 4)) {
    try {
      const page = await client.get(mat.href);
      if (/login_wf/i.test(page.url)) {
        scrapeErrors.push(`${mat.href}: redirect login`);
        continue;
      }
      store(captureKey(mat.href), page.html);
      const sections = parseSectionTargets(page.html);
      // Known section shortcuts if matricula HTML is already composed (browser dump)
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
      for (const href of unique(extras).slice(0, 16)) {
        if (!href || pages[captureKey(href)]) continue;
        try {
          const sub = await client.get(href);
          if (/login_wf/i.test(sub.url)) continue;
          store(captureKey(href), sub.html);
        } catch (err) {
          scrapeErrors.push(
            `${href}: ${err instanceof Error ? err.message : "error"}`,
          );
        }
      }
    } catch (err) {
      scrapeErrors.push(
        `${mat.href}: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  // If home already has composed desktop HTML (like the user paste), parse it directly
  const notices = mergeUnique(
    pickBest(pages, parseNotices, /agenda|avis|aviso/i),
    parseNotices(homeHtml),
    (n) => n.id + n.title,
  );
  const absences = mergeUnique(
    pickBest(pages, parseAbsences, /assist|asist|falta/i),
    parseAbsences(homeHtml),
    (a) => a.id + a.date,
  );
  const grades = mergeUnique(
    pickBest(pages, parseGrades, /calific|qualific|nota/i),
    parseGrades(homeHtml),
    (g) => g.id + g.subject,
  );
  const messages = mergeUnique(
    pickBest(pages, parseMessages, /comunic|missatge|mensaje|tipo=cm/i),
    parseMessages(homeHtml),
    (m) => m.id + m.subject,
  );
  const activities = mergeUnique(
    pickBest(pages, parseActivities, /activitat|actividad/i),
    parseActivities(homeHtml),
    (a) => a.id + a.title,
  );
  const subjects = mergeUnique(
    pickBest(pages, parseSubjects, /materia|assignatur/i),
    parseSubjects(homeHtml),
    (s) => s.subject,
  );
  const schedule = mergeUnique(
    pickBest(pages, parseSchedule, /horario|horari/i),
    parseSchedule(homeHtml),
    (s) => `${s.day}-${s.start}-${s.subject}`,
  );
  const behaviors = parseBehaviors(homeHtml);

  const diagnostics = {
    pages: Object.entries(pages).map(([key, html]) => ({
      key,
      bytes: html.length,
      title: cheerio.load(html)("title").first().text().replace(/\s+/g, " ").trim(),
      links: extractNavLinks(html).length,
    })),
    navLinks: nav.slice(0, 40),
    scrapeErrors: scrapeErrors.slice(0, 20),
    note:
      notices.length +
        absences.length +
        grades.length +
        messages.length +
        activities.length +
        schedule.length +
        subjects.length ===
      0
        ? "S'ha capturat HTML però els parsers no han trobat files. Mira /api/debug/captures"
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
    diagnostics,
  };
  state.lastDashboard = dashboard;
  return dashboard;
}

function captureKey(href: string) {
  return href
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^.*\//, "")
    .replace(/[?&=]/g, "_")
    .slice(0, 120) || "page";
}

function pickBest<T>(
  pages: Record<string, string>,
  parse: (html: string) => T[],
  keywords: RegExp,
) {
  let best: T[] = [];
  let bestScore = -1;
  for (const [key, html] of Object.entries(pages)) {
    const items = parse(html);
    if (!items.length) continue;
    const score = items.length * 10 + pageScore(key, html, keywords);
    if (score > bestScore) {
      bestScore = score;
      best = items;
    }
  }
  return best;
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
