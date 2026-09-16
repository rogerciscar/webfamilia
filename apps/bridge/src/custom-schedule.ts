import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { ScheduleSlot } from "@pont/shared";
import { DATA_DIR } from "./vault";

const FILE = path.join(DATA_DIR, "custom-schedule.json");

type Store = { slots: ScheduleSlot[] };

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
        CREATE TABLE IF NOT EXISTS pont_custom_schedule (
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

async function ensure() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<Store> {
  if (pool) {
    await ensurePg();
    const res = await pool!.query(`SELECT payload FROM pont_custom_schedule ORDER BY updated_at ASC`);
    return {
      slots: res.rows.map((r) => r.payload as ScheduleSlot).filter(Boolean),
    };
  }
  try {
    await access(FILE);
    const raw = await readFile(FILE, "utf8");
    const data = JSON.parse(raw) as Store;
    return { slots: Array.isArray(data.slots) ? data.slots : [] };
  } catch {
    return { slots: [] };
  }
}

async function writeStore(store: Store) {
  if (pool) {
    await ensurePg();
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM pont_custom_schedule");
      for (const slot of store.slots) {
        await client.query(
          `INSERT INTO pont_custom_schedule (id, payload, updated_at) VALUES ($1, $2::jsonb, NOW())`,
          [slot.id, JSON.stringify(slot)],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return;
  }
  await ensure();
  await writeFile(FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export async function listCustomSlots(studentId?: string) {
  const store = await readStore();
  if (!studentId) return store.slots;
  return store.slots.filter((s) => s.studentId === studentId);
}

export async function upsertCustomSlot(slot: Omit<ScheduleSlot, "id" | "custom"> & { id?: string }) {
  const store = await readStore();
  const id = slot.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next: ScheduleSlot = {
    id,
    day: slot.day,
    start: slot.start,
    end: slot.end,
    subject: slot.subject,
    studentId: slot.studentId,
    studentName: slot.studentName,
    custom: true,
  };
  const idx = store.slots.findIndex((s) => s.id === id);
  if (idx >= 0) store.slots[idx] = next;
  else store.slots.push(next);
  await writeStore(store);
  return next;
}

export async function deleteCustomSlot(id: string) {
  const store = await readStore();
  store.slots = store.slots.filter((s) => s.id !== id);
  await writeStore(store);
}

export function customScheduleBackend() {
  return pool ? "postgres" : "file";
}
