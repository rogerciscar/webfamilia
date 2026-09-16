import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import pg from "pg";
import { DATA_DIR } from "./vault";

const COOKIE = "wf_session";
const TTL_MS = Number(process.env.PONT_SESSION_DAYS || 365) * 24 * 60 * 60 * 1000;
const STORE_PATH = path.join(DATA_DIR, "browser-sessions.json");

type BrowserSession = {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  mode: "mock" | "live";
};

const sessions = new Map<string, BrowserSession>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
    })
  : null;

let pgReady: Promise<void> | null = null;

function ensurePg() {
  if (!pool) return null;
  if (!pgReady) {
    pgReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS pont_sessions (
          token_hash TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        pgReady = null;
        throw err;
      });
  }
  return pgReady;
}

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

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const now = Date.now();
  if (pool) {
    try {
      await ensurePg();
      const res = await pool!.query(
        `SELECT payload FROM pont_sessions WHERE expires_at > NOW()`,
      );
      for (const row of res.rows) {
        const s = row.payload as BrowserSession;
        if (s?.tokenHash && s.expiresAt > now) sessions.set(s.tokenHash, s);
      }
      return;
    } catch (err) {
      console.error("[webfamilia] session pg load failed", err);
    }
  }
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const raw = await readFile(STORE_PATH, "utf8");
    const data = JSON.parse(raw) as { sessions?: BrowserSession[] };
    for (const row of data.sessions || []) {
      if (row.expiresAt > now) sessions.set(row.tokenHash, row);
    }
  } catch {
    // empty
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 250);
}

async function persist() {
  const now = Date.now();
  const alive = [...sessions.values()].filter((s) => s.expiresAt > now);
  sessions.clear();
  for (const s of alive) sessions.set(s.tokenHash, s);
  if (pool) {
    try {
      await ensurePg();
      await pool!.query(`DELETE FROM pont_sessions`);
      for (const s of alive) {
        await pool!.query(
          `INSERT INTO pont_sessions (token_hash, payload, expires_at)
           VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0))
           ON CONFLICT (token_hash) DO UPDATE
           SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
          [s.tokenHash, JSON.stringify(s), s.expiresAt],
        );
      }
      return;
    } catch (err) {
      console.error("[webfamilia] session pg persist failed", err);
    }
  }
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify({ sessions: alive }, null, 2), {
      mode: 0o600,
    });
  } catch (err) {
    console.error("[webfamilia] session persist failed", err);
  }
}

function writeCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function createBrowserSession(mode: "mock" | "live", c: Context) {
  await ensureLoaded();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  sessions.set(hashToken(token), {
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt: now + TTL_MS,
    lastSeenAt: now,
    mode,
  });
  writeCookie(c, token);
  scheduleSave();
  return token;
}

export async function clearBrowserSession(c: Context) {
  await ensureLoaded();
  const token = getCookie(c, COOKIE);
  if (token) sessions.delete(hashToken(token));
  deleteCookie(c, COOKIE, { path: "/" });
  scheduleSave();
}

/** Read session and slide expiry (keep device signed-in up to ~1 year of activity). */
export async function touchBrowserSession(c: Context): Promise<BrowserSession | null> {
  await ensureLoaded();
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const key = hashToken(token);
  const row = sessions.get(key);
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt < now) {
    sessions.delete(key);
    scheduleSave();
    return null;
  }
  row.lastSeenAt = now;
  row.expiresAt = now + TTL_MS;
  sessions.set(key, row);
  writeCookie(c, token);
  scheduleSave();
  return row;
}

export async function requireBrowserSession(c: Context): Promise<BrowserSession | null> {
  return touchBrowserSession(c);
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

/** Never expose full NIF/NIE in the UI. */
export function maskUsername(username?: string | null) {
  if (!username) return undefined;
  const u = username.trim().toUpperCase();
  if (u.length <= 3) return "••••";
  return `${"•".repeat(Math.max(4, u.length - 3))}${u.slice(-3)}`;
}
