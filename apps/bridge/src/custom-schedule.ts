import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import type { CustomEventKind, ScheduleSlot } from "@pont/shared";
import { DATA_DIR } from "./vault";

const FILE = path.join(DATA_DIR, "custom-schedule.json");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

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

function cleanIso(v?: string) {
  if (!v) return undefined;
  const t = v.trim().slice(0, 10);
  return ISO.test(t) ? t : undefined;
}

function resolveKind(slot: {
  eventKind?: CustomEventKind;
  dateIso?: string;
}): CustomEventKind {
  if (slot.eventKind === "puntual" || slot.eventKind === "setmanal") return slot.eventKind;
  return slot.dateIso ? "puntual" : "setmanal";
}

const WEEKDAY_ORDER = ["Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte", "Diumenge"];

function orderWeekdays(days: string[]): string[] {
  const set = new Set(days.map((d) => d.trim()).filter(Boolean));
  return WEEKDAY_ORDER.filter((d) => set.has(d));
}

export async function listCustomSlots(studentId?: string) {
  const store = await readStore();
  if (!studentId) return store.slots;
  return store.slots.filter((s) => s.studentId === studentId);
}

export async function upsertCustomSlot(slot: Omit<ScheduleSlot, "id" | "custom"> & { id?: string }) {
  const store = await readStore();
  const id = slot.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const eventKind = resolveKind(slot);
  const dateIso = cleanIso(slot.dateIso);
  const dateFrom = cleanIso(slot.dateFrom);
  const dateTo = cleanIso(slot.dateTo);
  const days = Array.isArray(slot.days)
    ? [...new Set(slot.days.map((d) => String(d || "").trim()).filter(Boolean))]
    : [];
  if (eventKind === "puntual" && !dateIso) throw new Error("Cal la data de l'activitat puntual.");
  if (eventKind === "setmanal") {
    const weekdays = orderWeekdays(days.length ? days : slot.day?.trim() ? [slot.day.trim()] : []);
    if (!weekdays.length) throw new Error("Cal almenys un dia de la setmana.");
    if (!dateFrom || !dateTo) throw new Error("Cal data d'inici i data de fi.");
    if (dateFrom > dateTo) throw new Error("La data d'inici ha de ser anterior a la de fi.");
    const primary = weekdays[0]!;
    const next: ScheduleSlot = {
      id,
      day: primary,
      days: weekdays,
      subject: slot.subject.trim(),
      studentId: slot.studentId,
      studentName: slot.studentName,
      custom: true,
      eventKind,
      start: slot.start || undefined,
      end: slot.end || undefined,
      place: slot.place?.trim() || undefined,
      notes: slot.notes?.trim() || undefined,
      dateFrom,
      dateTo,
    };
    const idx = store.slots.findIndex((s) => s.id === id);
    if (idx >= 0) store.slots[idx] = next;
    else store.slots.push(next);
    await writeStore(store);
    return next;
  }
  const next: ScheduleSlot = {
    id,
    day: slot.day || "Dilluns",
    subject: slot.subject.trim(),
    studentId: slot.studentId,
    studentName: slot.studentName,
    custom: true,
    eventKind,
    start: slot.start || undefined,
    end: slot.end || undefined,
    place: slot.place?.trim() || undefined,
    notes: slot.notes?.trim() || undefined,
    dateIso,
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
