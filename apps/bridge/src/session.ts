import {
  parseAbsences,
  parseActivities,
  parseBehaviors,
  parseGrades,
  parseMessages,
  parseNotices,
  parseStudents,
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

const CANDIDATE_PATHS = [
  "main_wf",
  "avisos_wf",
  "faltas_wf",
  "notas_wf",
  "mensajes_wf",
  "actividades_wf",
  "horario_wf",
  "comportamientos_wf",
  "evaluaciones_wf",
  "calificaciones_wf",
  "asistencia_wf",
  "retrasos_wf",
  "comunicados_wf",
  "tutorias_wf",
  "agenda_wf",
  "boletines_wf",
  "seleccion_alumno_wf",
  "alumnos_wf",
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
    state.captures.main = page.html;
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
      // Login worked; scraping can still fail. Return a minimal live dashboard.
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
      { bytes: html.length, preview: html.slice(0, 400) },
    ]),
  );
}

export function getCaptureHtml(key: string) {
  return state.captures[key] ?? null;
}

async function buildDashboard(client: WebFamiliaClient): Promise<Dashboard> {
  const pages: Record<string, string> = {};
  if (client.lastHtml) {
    pages.main = client.lastHtml;
    state.captures.main = client.lastHtml;
  }
  const nav = extractNavLinks(client.lastHtml || "");
  const discovered = nav
    .map((l) => normalizeTarget(l.href))
    .filter((h): h is string => Boolean(h));
  const targets = unique([...discovered, ...CANDIDATE_PATHS]).slice(0, 30);
  for (const target of targets) {
    try {
      const page = await client.get(target);
      if (/login_wf/i.test(page.url)) continue;
      pages[target] = page.html;
      state.captures[target] = page.html;
      // Follow secondary links inside each page (one level)
      const inner = extractNavLinks(page.html)
        .map((l) => normalizeTarget(l.href))
        .filter((h): h is string => Boolean(h) && !pages[h!])
        .slice(0, 6);
      for (const next of inner) {
        try {
          const sub = await client.get(next);
          if (/login_wf/i.test(sub.url)) continue;
          pages[next] = sub.html;
          state.captures[next] = sub.html;
        } catch {
          // ignore
        }
      }
    } catch {
      // route may not exist for this center/user
    }
  }

  const students = parseStudents(Object.values(pages).join("\n"));
  const notices = pickBest(pages, parseNotices, /avis|aviso|comunicat|comunicado|noticia/i);
  const absences = pickBest(pages, parseAbsences, /falta|retard|retraso|asist|absen/i);
  const grades = pickBest(pages, parseGrades, /nota|calific|avaluaci|evaluaci|boletin|butllet/i);
  const messages = pickBest(pages, parseMessages, /missatge|mensaje|correu|correo|bandeja|mail/i);
  const activities = pickBest(pages, parseActivities, /activitat|actividad|extraescol|agenda|sortida|salida/i);
  const behaviors = pickBest(pages, parseBehaviors, /conducta|comport|observac|incidencia/i);

  const diagnostics = {
    pages: Object.entries(pages).map(([key, html]) => ({
      key,
      bytes: html.length,
      title: cheerio.load(html)("title").first().text().replace(/\s+/g, " ").trim(),
      links: extractNavLinks(html).length,
    })),
    navLinks: nav.slice(0, 40),
    note:
      notices.length + absences.length + grades.length + messages.length === 0
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
    diagnostics,
  };
  state.lastDashboard = dashboard;
  return dashboard;
}

function normalizeTarget(href: string) {
  const raw = href.trim();
  if (!raw || raw === "#" || raw.startsWith("mailto:") || raw.startsWith("tel:")) return null;
  let pathPart = raw;
  let search = "";
  if (/^https?:/i.test(raw)) {
    if (!/familia\.edu\.gva\.es/i.test(raw)) return null;
    const u = new URL(raw);
    pathPart = u.pathname;
    search = u.search;
  } else {
    const q = raw.indexOf("?");
    if (q >= 0) {
      pathPart = raw.slice(0, q);
      search = raw.slice(q);
    }
  }
  const file = pathPart.split("/").filter(Boolean).pop() || "";
  if (!file || /login_wf/i.test(file)) return null;
  return file + search;
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

function unique(items: string[]) {
  return [...new Set(items.map((i) => i.replace(/^\.\//, "")))];
}
