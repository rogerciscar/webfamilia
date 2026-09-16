import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMenuText } from "../src/menu-pdf.ts";
import { toIsoDate } from "../src/dates.ts";
import { classifyAttachment } from "../src/attachments.ts";
import { parseNotices, enrichStudent, parseStudents } from "../src/parsers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "../fixtures");

if (toIsoDate("09/09/2026") !== "2026-09-09") throw new Error("toIsoDate failed");
if (classifyAttachment("MENÚ SETEMBRE 26 V - CS.pdf", "Menú menjador") !== "menu_menjador") {
  throw new Error("classify menu failed");
}
if (classifyAttachment("MENÚS ESPECIALES SEPTIEMBRE 26 CS.pdf") !== "menu_especial") {
  throw new Error("classify especial failed");
}

const menuTxt = readFileSync(path.join(fixtures, "menu_setembre_layout.txt"), "utf8");
const menu = parseMenuText(menuTxt, { sourceFile: "MENÚ SETEMBRE 26 V - CS.pdf" });
if (!menu) throw new Error("menu parse null");
if (menu.month !== 9 || menu.year !== 2026) throw new Error("bad month/year");
const day9 = menu.variants[0]?.days.find((d) => d.dayOfMonth === 9);
if (!day9) throw new Error("missing day 9");
if (day9.date !== "2026-09-09") throw new Error(`bad date ${day9.date}`);
if (!day9.courses.some((c) => /Arr[oò]s basmati/i.test(c))) throw new Error("missing course");
if (day9.saladCode !== "A3") throw new Error(`salad ${day9.saladCode}`);
if (day9.dessert !== "FRUITA") throw new Error(`dessert ${day9.dessert}`);
if (day9.nutrition?.kcal !== 741) throw new Error(`kcal ${day9.nutrition?.kcal}`);

const listado = readFileSync(path.join(fixtures, "listar_alumnos_anon.html"), "utf8");
const students = parseStudents(listado);
const notices = parseNotices(listado, {
  studentId: students[0]?.id,
  studentName: students[0]?.name,
});
if (!notices.length) throw new Error("no agenda notices");
if (!notices[0].dateIso) throw new Error("notice missing dateIso");
if (notices[0].studentId !== students[0]?.id) throw new Error("notice studentId");

const enriched = enrichStudent(listado, students[0]!);
if (!enriched.group && !enriched.course) throw new Error("enrich group missing");

console.log("extractors ok", {
  notices: notices.length,
  menuDays: menu.variants[0].days.length,
  day9: day9.date,
});
