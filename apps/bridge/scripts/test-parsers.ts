import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAbsences,
  parseActivities,
  parseDocumentLinks,
  parseMatriculaLinks,
  parseNotices,
  parseSchedule,
  parseSectionTargets,
  parseStudents,
  parseSubjects,
  enrichStudent,
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

const enriched = enrichStudent(matricula, students[0]);
if (!enriched.tutorName?.includes("TUTOR")) throw new Error("expected tutor from matricula");

const assist = readFileSync(path.join(fixtures, "assistencies_anon.html"), "utf8");
const absences = parseAbsences(assist);
if (absences.length < 2) throw new Error(`expected absences, got ${absences.length}`);
if (absences[0].kind !== "retard") throw new Error("expected retard");

const detail = readFileSync(path.join(fixtures, "agenda_detail_anon.html"), "utf8");
const docs = parseDocumentLinks(detail);
if (docs.length < 2) throw new Error(`expected document links, got ${docs.length}`);
if (!docs.some((d) => /pdf|documento/i.test(d.href + d.text))) {
  throw new Error("expected pdf-like document link");
}

console.log("parsers ok", {
  students: students.length,
  notices: noticesHome.length,
  activities: activities.length,
  subjects: subjects.length,
  schedule: schedule.length,
  sections: sections.length,
  absences: absences.length,
  tutor: enriched.tutorName,
  docs: docs.length,
});
