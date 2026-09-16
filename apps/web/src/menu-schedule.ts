import type { MenuDay, MenuExtraction, Notice, ScheduleSlot } from "./api";

const WEEK_MAP: Record<string, string> = {
  dilluns: "Dilluns",
  dimarts: "Dimarts",
  dimecres: "Dimecres",
  dijous: "Dijous",
  divendres: "Divendres",
  lunes: "Dilluns",
  martes: "Dimarts",
  miercoles: "Dimecres",
  miércoles: "Dimecres",
  jueves: "Dijous",
  viernes: "Divendres",
};

export function normalizeDay(day: string) {
  const d = day.trim().toLowerCase();
  if (d.startsWith("dil") || d.startsWith("lun")) return "Dilluns";
  if (d.startsWith("dima") || d.startsWith("mart")) return "Dimarts";
  if (d.startsWith("dime") || d.startsWith("mier") || d.startsWith("mié")) return "Dimecres";
  if (d.startsWith("dij") || d.startsWith("jue")) return "Dijous";
  if (d.startsWith("div") || d.startsWith("vie")) return "Divendres";
  return WEEK_MAP[d] || day;
}

function weekdayFromMenu(day: MenuDay) {
  return normalizeDay(day.weekday || "");
}

function basalVariant(menu: MenuExtraction) {
  return (
    menu.variants.find((v) => /basal|men[uú](?!.*nits)/i.test(v.name)) ||
    menu.variants[0]
  );
}

function dinnerVariant(menu: MenuExtraction) {
  return menu.variants.find((v) => /nits|complementari|sopar|cena/i.test(v.name));
}

function formatCourses(day: MenuDay) {
  const parts = [...(day.courses || [])];
  if (day.saladCode) parts.push(day.saladCode);
  if (day.dessert) parts.push(day.dessert);
  return parts.filter(Boolean).join(" · ") || "Menú";
}

export type MenuSlot = ScheduleSlot & { menuKind?: "lunch" | "dinner" };

/** Inject lunch 12:45–13:15 and dinner 20:00–20:30 into the day schedule. */
export function menuSlotsForDay(
  menus: MenuExtraction[],
  dayName: string,
  studentId?: string | null,
): MenuSlot[] {
  const day = normalizeDay(dayName);
  const out: MenuSlot[] = [];
  for (const menu of menus) {
    const basal = basalVariant(menu);
    const dinner = dinnerVariant(menu);
    const lunchDay = basal?.days.find((d) => weekdayFromMenu(d) === day);
    const dinnerDay = dinner?.days.find((d) => weekdayFromMenu(d) === day);
    if (lunchDay) {
      out.push({
        id: `menu-lunch-${menu.attachmentId || menu.sourceFile}-${day}`,
        day,
        start: "12:45",
        end: "13:15",
        subject: `Dinar · ${formatCourses(lunchDay)}`,
        studentId: studentId || menu.studentId,
        studentName: menu.studentName,
        custom: false,
        menuKind: "lunch",
      });
    }
    if (dinnerDay) {
      out.push({
        id: `menu-dinner-${menu.attachmentId || menu.sourceFile}-${day}`,
        day,
        start: "20:00",
        end: "20:30",
        subject: `Sopar · ${formatCourses(dinnerDay)}`,
        studentId: studentId || menu.studentId,
        studentName: menu.studentName,
        custom: false,
        menuKind: "dinner",
      });
    } else if (lunchDay && !dinner) {
      // No complementary dinner PDF: still propose evening slot from lunch dessert note if any
      // Skip — user asked dinner from menu proposal specifically
    }
  }
  // Dedupe by start+kind keeping first
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.start}:${s.menuKind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Agenda rows for dinner proposals (20:00–20:30) across menu days. */
export function dinnerAgendaNotices(
  menus: MenuExtraction[],
  studentId?: string | null,
): Notice[] {
  const out: Notice[] = [];
  for (const menu of menus) {
    const dinner = dinnerVariant(menu);
    const days = dinner?.days?.length ? dinner.days : [];
    // If no nits variant, invent dinner agenda from basal days as "proposta de sopar" skip
    // User wants dinner proposal — use nits when present; else skip
    for (const d of days) {
      out.push({
        id: `dinner-${menu.attachmentId || menu.sourceFile}-${d.date}`,
        title: `Sopar 20:00–20:30 · ${formatCourses(d)}`,
        body: dinner?.name || "Proposta de sopar",
        date: d.date,
        dateIso: d.date,
        studentId: studentId || menu.studentId,
        studentName: menu.studentName,
        hasDetail: false,
        attachments: [],
      });
    }
  }
  // Prefer unique by date
  const seen = new Set<string>();
  return out
    .filter((n) => {
      const k = n.dateIso || n.date || n.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.dateIso || "").localeCompare(b.dateIso || ""));
}

/** Also surface today's lunch in agenda if useful — kept separate; dinner is primary. */
export function lunchAgendaNotices(
  menus: MenuExtraction[],
  studentId?: string | null,
): Notice[] {
  const out: Notice[] = [];
  for (const menu of menus) {
    const basal = basalVariant(menu);
    for (const d of basal?.days || []) {
      out.push({
        id: `lunch-${menu.attachmentId || menu.sourceFile}-${d.date}`,
        title: `Dinar 12:45–13:15 · ${formatCourses(d)}`,
        body: basal?.name || "Menú menjador",
        date: d.date,
        dateIso: d.date,
        studentId: studentId || menu.studentId,
        studentName: menu.studentName,
        hasDetail: false,
        attachments: [],
      });
    }
  }
  const seen = new Set<string>();
  return out
    .filter((n) => {
      const k = n.dateIso || n.date || n.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.dateIso || "").localeCompare(b.dateIso || ""));
}
