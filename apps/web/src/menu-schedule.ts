import type { MenuDay, MenuExtraction, ScheduleSlot } from "./api";

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

/** Resolve A1–A5 to the salad legend text when available. */
export function saladLabel(code: string | undefined, salads?: Record<string, string>) {
  if (!code) return "";
  const key = code.trim().toUpperCase();
  const name = salads?.[key] || salads?.[code];
  if (name) return name;
  return key;
}

function cleanPart(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** Join all courses / salad / dessert into one horizontal line. */
export function formatCourses(day: MenuDay, salads?: Record<string, string>) {
  const parts = [...(day.courses || [])];
  if (day.saladCode) parts.push(saladLabel(day.saladCode, salads));
  if (day.dessert) parts.push(day.dessert);
  return parts.map(cleanPart).filter(Boolean).join(" · ") || "Menú";
}

export type MenuSlot = ScheduleSlot & { menuKind?: "lunch" | "dinner" };

/** Pick the MenuDay for a concrete calendar date (preferred) or weekday fallback. */
export function menuDayForSchedule(
  days: MenuDay[] | undefined,
  dayName: string,
  dateIso?: string,
): MenuDay | undefined {
  if (!days?.length) return undefined;
  if (dateIso) {
    const byDate = days.find((d) => (d.date || "").slice(0, 10) === dateIso.slice(0, 10));
    if (byDate) return byDate;
    // Same month: prefer dayOfMonth match when date string is missing/wrong
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.slice(0, 10));
    if (m) {
      const dayNum = Number(m[3]);
      const byDom = days.find((d) => d.dayOfMonth === dayNum);
      if (byDom) return byDom;
    }
    // Do not fall back to another week's same weekday when a date was requested
    return undefined;
  }
  const day = normalizeDay(dayName);
  return days.find((d) => weekdayFromMenu(d) === day);
}

/** Inject lunch 12:45–13:15 and dinner 20:00–20:30 into the day schedule. */
export function menuSlotsForDay(
  menus: MenuExtraction[],
  dayName: string,
  studentId?: string | null,
  dateIso?: string,
): MenuSlot[] {
  const day = normalizeDay(dayName);
  const out: MenuSlot[] = [];
  for (const menu of menus) {
    const basal = basalVariant(menu);
    const dinner = dinnerVariant(menu);
    const lunchDay = menuDayForSchedule(basal?.days, day, dateIso);
    const dinnerDay = menuDayForSchedule(dinner?.days, day, dateIso);
    const stamp = dateIso || day;
    if (lunchDay) {
      out.push({
        id: `menu-lunch-${menu.attachmentId || menu.sourceFile}-${stamp}`,
        day,
        start: "12:45",
        end: "13:15",
        subject: `Dinar · ${formatCourses(lunchDay, basal?.salads)}`,
        studentId: studentId || menu.studentId,
        studentName: menu.studentName,
        custom: false,
        menuKind: "lunch",
      });
    }
    if (dinnerDay) {
      out.push({
        id: `menu-dinner-${menu.attachmentId || menu.sourceFile}-${stamp}`,
        day,
        start: "20:00",
        end: "20:30",
        subject: `Sopar · ${formatCourses(dinnerDay, dinner?.salads || basal?.salads)}`,
        studentId: studentId || menu.studentId,
        studentName: menu.studentName,
        custom: false,
        menuKind: "dinner",
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.start}:${s.menuKind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
