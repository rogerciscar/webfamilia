import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { Dashboard } from "@pont/shared";
import { DATA_DIR } from "./vault";

const FILE = path.join(DATA_DIR, "last-dashboard.json");

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
        CREATE TABLE IF NOT EXISTS pont_dashboard (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

/** Persist last live dashboard (metadata + menus). PDF bytes stay on disk/volume. */
export async function saveDashboardCache(dashboard: Dashboard) {
  if (dashboard.source !== "live") return;
  const existing = await loadDashboardCache();
  if (existing && cacheContentScore(dashboard) + 8 < cacheContentScore(existing) * 0.4) {
    const nextEmpty =
      (dashboard.notices?.length || 0) === 0 &&
      (dashboard.schedule || []).filter((s) => !s.custom).length === 0;
    const prevRich =
      (existing.notices?.length || 0) >= 3 ||
      (existing.schedule || []).filter((s) => !s.custom).length >= 4;
    if (nextEmpty && prevRich) {
      console.warn(
        `[webfamilia] skip cache save of hollow dashboard (kept richer cache · notices=${existing.notices.length} schedule=${existing.schedule.length})`,
      );
      return;
    }
  }
  const slim = {
    ...dashboard,
    diagnostics: dashboard.diagnostics
      ? {
          ...dashboard.diagnostics,
          pages: (dashboard.diagnostics.pages || []).map((p) => ({
            key: p.key,
            bytes: p.bytes,
            title: p.title,
            links: p.links,
          })),
        }
      : undefined,
  };
  if (pool) {
    await ensurePg();
    await pool!.query(
      `
      INSERT INTO pont_dashboard (id, payload, updated_at)
      VALUES ('latest', $1::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `,
      [JSON.stringify(slim)],
    );
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(slim), { mode: 0o600 });
}

function cacheContentScore(d: Dashboard) {
  return (
    (d.students?.length || 0) * 8 +
    (d.schedule || []).filter((s) => !s.custom).length * 4 +
    (d.subjects?.length || 0) * 4 +
    (d.notices?.length || 0) * 3 +
    (d.menus?.length || 0) * 2
  );
}

export async function loadDashboardCache(): Promise<Dashboard | null> {
  if (pool) {
    try {
      await ensurePg();
      const res = await pool!.query(
        `SELECT payload FROM pont_dashboard WHERE id = 'latest' LIMIT 1`,
      );
      const payload = res.rows[0]?.payload as Dashboard | undefined;
      if (payload?.source === "live") return payload;
    } catch (err) {
      console.error("[webfamilia] dashboard cache load failed:", err);
    }
    return null;
  }
  try {
    await access(FILE);
    const raw = await readFile(FILE, "utf8");
    const data = JSON.parse(raw) as Dashboard;
    return data?.source === "live" ? data : null;
  } catch {
    return null;
  }
}
