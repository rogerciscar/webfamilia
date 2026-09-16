import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseActivities,
  parseMatriculaLinks,
  parseNotices,
  parseSchedule,
  parseSectionTargets,
  parseStudents,
  parseSubjects,
} from "../src/parsers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "../fixtures");

const listado = readFileSync(path.join(fixtures, "listar_alumnos_anon.html"), "utf8");
const matricula = readFileSync(path.join(fixtures, "matricula_anon.html"), "utf8");
const agenda = readFileSync(path.join(fixtures, "agenda_anon.html"), "utf8");

const students = parseStudents(listado);
if (students.length !== 2) throw new Error(`expected 2 students, got ${students.length}`);
if (!students[0].name.includes("ALUMNE UNO")) throw new Error("bad student name");

const mats = parseMatriculaLinks(listado);
if (mats.length < 2) throw new Error(`expected matricula links, got ${mats.length}`);

const noticesHome = parseNotices(listado);
if (noticesHome.length < 3) throw new Error(`expected agenda notices, got ${noticesHome.length}`);

const noticesAjax = parseNotices(agenda);
if (noticesAjax.length < 2) throw new Error(`expected ajax agenda, got ${noticesAjax.length}`);

const activities = parseActivities(listado);
if (activities.length < 1) throw new Error("expected activities");

const subjects = parseSubjects(listado);
if (subjects.length < 2) throw new Error("expected subjects");

const schedule = parseSchedule(listado);
if (schedule.length < 3) throw new Error(`expected schedule slots, got ${schedule.length}`);

const sections = parseSectionTargets(matricula);
if (sections.length < 5) throw new Error(`expected section targets, got ${sections.length}`);
if (!sections.some((s) => s.kind === "horarios")) throw new Error("missing horarios section");
if (!sections.some((s) => s.kind === "agenda")) throw new Error("missing agenda section");

console.log("parsers ok", {
  students: students.length,
  notices: noticesHome.length,
  activities: activities.length,
  subjects: subjects.length,
  schedule: schedule.length,
  sections: sections.length,
});
