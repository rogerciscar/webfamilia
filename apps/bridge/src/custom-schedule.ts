import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScheduleSlot } from "@pont/shared";
import { DATA_DIR } from "./vault";

const FILE = path.join(DATA_DIR, "custom-schedule.json");

type Store = { slots: ScheduleSlot[] };

async function ensure() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<Store> {
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
