import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const COOKIE = "wf_session";
const TTL_MS = Number(process.env.PONT_SESSION_DAYS || 14) * 24 * 60 * 60 * 1000;

type BrowserSession = {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  mode: "mock" | "live";
};

const sessions = new Map<string, BrowserSession>();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isProd() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production";
}

export function mockAllowed() {
  if (process.env.PONT_ALLOW_MOCK === "1") return true;
  if (process.env.PONT_ALLOW_MOCK === "0") return false;
  return !isProd();
}

export function createBrowserSession(mode: "mock" | "live", c: Context) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  sessions.set(hashToken(token), {
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: now + TTL_MS,
    mode,
  });
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return token;
}

export function clearBrowserSession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) sessions.delete(hashToken(token));
  deleteCookie(c, COOKIE, { path: "/" });
}

export function readBrowserSession(c: Context): BrowserSession | null {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = sessions.get(hashToken(token));
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    sessions.delete(hashToken(token));
    return null;
  }
  return row;
}

export function requireBrowserSession(c: Context): BrowserSession | null {
  return readBrowserSession(c);
}

export function passwordsMatch(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  try {
    return timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}
