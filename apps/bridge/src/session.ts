import {
  parseAbsences,
  parseActivities,
  parseBehaviors,
  parseGrades,
  parseMessages,
  parseNotices,
  parseStudents,
} from "./parsers";
import { mockDashboard } from "./mock";
import { extractNavLinks, WebFamiliaClient } from "./webfamilia";
import type { Dashboard, SessionStatus } from "@pont/shared";
import {
  clearCredentials,
  loadCredentials,
  peekVaultMeta,
  saveCredentials,
  vaultExists,
} from "./vault";

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
  return {
    authenticated: state.mode === "live" && Boolean(state.client?.isAuthenticated()),
    mode: state.mode,
    username: state.client?.username ?? meta?.username,
    hasStoredCredentials: await vaultExists(),
    vaultMode: meta?.mode,
    lastLoginAt: state.lastLoginAt ?? meta?.updatedAt,
    error: state.lastError,
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
        { username: input.username, password: input.password },
        { mode, masterPassword: input.masterPassword },
      );
    }
    return buildDashboard(client);
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
  const nav = extractNavLinks(client.lastHtml || "");
  const discovered = nav
    .map((l) => l.href.split("/").pop() || l.href)
    .filter((h) => /_wf/i.test(h));
  const targets = unique([...discovered, ...CANDIDATE_PATHS]).slice(0, 12);
  for (const target of targets) {
    try {
      const page = await client.get(target);
      pages[target] = page.html;
      state.captures[target] = page.html;
    } catch {
      // route may not exist for this center/user
    }
  }
  if (!pages.main_wf && client.lastHtml) pages.main_wf = client.lastHtml;
  const htmlBlob = Object.values(pages).join("\n");
  const students = parseStudents(htmlBlob);
  const dashboard: Dashboard = {
    source: "live",
    capturedAt: new Date().toISOString(),
    students,
    student: students[0] ?? null,
    notices: firstNonEmpty(pages, ["avisos_wf", "main_wf"], parseNotices),
    absences: firstNonEmpty(pages, ["faltas_wf", "main_wf"], parseAbsences),
    grades: firstNonEmpty(pages, ["notas_wf", "evaluaciones_wf", "main_wf"], parseGrades),
    messages: firstNonEmpty(pages, ["mensajes_wf", "main_wf"], parseMessages),
    activities: firstNonEmpty(pages, ["actividades_wf", "main_wf"], parseActivities),
    behaviors: firstNonEmpty(pages, ["comportamientos_wf", "main_wf"], parseBehaviors),
  };
  state.lastDashboard = dashboard;
  return dashboard;
}

function firstNonEmpty<T>(
  pages: Record<string, string>,
  keys: string[],
  parse: (html: string) => T[],
) {
  for (const key of keys) {
    const html = pages[key];
    if (!html) continue;
    const items = parse(html);
    if (items.length) return items;
  }
  return [] as T[];
}

function unique(items: string[]) {
  return [...new Set(items.map((i) => i.replace(/[?#].*$/, "")))];
}
