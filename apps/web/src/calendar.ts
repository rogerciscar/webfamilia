import type { Activity, CustomEventKind, ScheduleSlot } from "./api";
import { normalizeDay } from "./menu-schedule";

const WEEKDAY_CA = ["Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres", "Dissabte", "Diumenge"] as const;
const WEEKDAY_SHORT = ["Dl", "Dt", "Dc", "Dj", "Dv", "Ds", "Dg"] as const;

export type CalendarEvent =
  | {
      kind: "escola";
      id: string;
      dateIso: string;
      title: string;
      place?: string;
      description?: string;
    }
  | {
      kind: "puntual" | "setmanal";
      id: string;
      dateIso: string;
      title: string;
      start?: string;
      end?: string;
      place?: string;
      notes?: string;
      slotId: string;
      slot: ScheduleSlot;
    };

export type MonthCell = {
  dateIso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
};

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function toDateIso(y: number, m0: number, d: number) {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

export function parseIso(iso: string): { y: number; m0: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) };
}

export function coerceDateIso(raw?: string, iso?: string): string | null {
  if (iso && /^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const dmY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (dmY) return `${dmY[3]}-${pad2(Number(dmY[2]))}-${pad2(Number(dmY[1]))}`;
  return null;
}

export function weekdayNameFromIso(dateIso: string): string {
  const p = parseIso(dateIso);
  if (!p) return "Dilluns";
  const js = new Date(p.y, p.m0, p.d).getDay();
  const idx = js === 0 ? 6 : js - 1;
  return WEEKDAY_CA[idx]!;
}

export function weekdaysCa() {
  return [...WEEKDAY_CA];
}

export function monthLabelCa(y: number, m0: number) {
  const d = new Date(y, m0, 1);
  const raw = d.toLocaleDateString("ca-ES", { month: "long", year: "numeric" });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function weekdayHeaders() {
  return [...WEEKDAY_SHORT];
}

function weekdayIndexMon0(dateIso: string): number {
  const p = parseIso(dateIso);
  if (!p) return 0;
  const js = new Date(p.y, p.m0, p.d).getDay();
  return js === 0 ? 6 : js - 1;
}

export function resolveEventKind(slot: ScheduleSlot): CustomEventKind {
  if (slot.eventKind === "puntual" || slot.eventKind === "setmanal") return slot.eventKind;
  return slot.dateIso ? "puntual" : "setmanal";
}

function inRange(dateIso: string, from?: string, to?: string) {
  if (from && dateIso < from) return false;
  if (to && dateIso > to) return false;
  return true;
}

/** Expand user custom slots onto days of the month. */
export function customEventsForMonth(
  slots: ScheduleSlot[],
  y: number,
  m0: number,
): CalendarEvent[] {
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const out: CalendarEvent[] = [];
  for (const slot of slots.filter((s) => s.custom)) {
    const eventKind = resolveEventKind(slot);
    if (eventKind === "puntual") {
      const dateIso = (slot.dateIso || "").slice(0, 10);
      const p = parseIso(dateIso);
      if (!p || p.y !== y || p.m0 !== m0) continue;
      out.push({
        kind: "puntual",
        id: `c-${slot.id}-${dateIso}`,
        dateIso,
        title: slot.subject,
        start: slot.start,
        end: slot.end,
        place: slot.place,
        notes: slot.notes,
        slotId: slot.id,
        slot,
      });
      continue;
    }
    const want = normalizeDay(slot.day);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateIso = toDateIso(y, m0, d);
      if (normalizeDay(weekdayNameFromIso(dateIso)) !== want) continue;
      if (!inRange(dateIso, slot.dateFrom, slot.dateTo)) continue;
      out.push({
        kind: "setmanal",
        id: `c-${slot.id}-${dateIso}`,
        dateIso,
        title: slot.subject,
        start: slot.start,
        end: slot.end,
        place: slot.place,
        notes: slot.notes,
        slotId: slot.id,
        slot,
      });
    }
  }
  return out;
}

export function activityEvents(activities: Activity[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const a of activities) {
    const dateIso = coerceDateIso(a.date, a.dateIso);
    if (!dateIso) continue;
    out.push({
      kind: "escola",
      id: `a-${a.id}`,
      dateIso,
      title: a.title,
      place: a.place,
      description: a.description,
    });
  }
  return out;
}

const KIND_ORDER = { escola: 0, puntual: 1, setmanal: 2 } as const;

export function buildMonthGrid(
  y: number,
  m0: number,
  events: CalendarEvent[],
  todayIso: string,
): MonthCell[] {
  const firstIso = toDateIso(y, m0, 1);
  const startPad = weekdayIndexMon0(firstIso);
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const prevDays = new Date(y, m0, 0).getDate();
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.dateIso) || [];
    list.push(e);
    byDate.set(e.dateIso, list);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if ("start" in a && "start" in b) return (a.start || "").localeCompare(b.start || "");
      return a.title.localeCompare(b.title);
    });
  }
  const cells: MonthCell[] = [];
  for (let i = 0; i < startPad; i++) {
    const d = prevDays - startPad + i + 1;
    const pm = m0 === 0 ? 11 : m0 - 1;
    const py = m0 === 0 ? y - 1 : y;
    const dateIso = toDateIso(py, pm, d);
    cells.push({
      dateIso,
      day: d,
      inMonth: false,
      isToday: dateIso === todayIso,
      events: byDate.get(dateIso) || [],
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateIso = toDateIso(y, m0, d);
    cells.push({
      dateIso,
      day: d,
      inMonth: true,
      isToday: dateIso === todayIso,
      events: byDate.get(dateIso) || [],
    });
  }
  while (cells.length % 7 !== 0) {
    const i = cells.length - (startPad + daysInMonth);
    const d = i + 1;
    const nm = m0 === 11 ? 0 : m0 + 1;
    const ny = m0 === 11 ? y + 1 : y;
    const dateIso = toDateIso(ny, nm, d);
    cells.push({
      dateIso,
      day: d,
      inMonth: false,
      isToday: dateIso === todayIso,
      events: byDate.get(dateIso) || [],
    });
  }
  return cells;
}

export function todayIsoLocal() {
  const n = new Date();
  return toDateIso(n.getFullYear(), n.getMonth(), n.getDate());
}

export function formatEventTime(start?: string, end?: string) {
  if (start && end) return `${start}–${end}`;
  return start || end || "";
}

export function addMonthsIso(iso: string, months: number) {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(p.y, p.m0 + months, p.d);
  return toDateIso(d.getFullYear(), d.getMonth(), d.getDate());
}
