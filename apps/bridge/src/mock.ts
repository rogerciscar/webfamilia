import type { Dashboard } from "@pont/shared";

export function mockDashboard(): Dashboard {
  return {
    source: "mock",
    capturedAt: new Date().toISOString(),
    student: {
      id: "1",
      name: "Mar Serra i Puig",
      course: "3r ESO B",
      center: "IES Exemple",
    },
    students: [
      {
        id: "1",
        name: "Mar Serra i Puig",
        course: "3r ESO B",
        center: "IES Exemple",
      },
      {
        id: "2",
        name: "Nil Serra i Puig",
        course: "5é Primària",
        center: "CEIP Exemple",
      },
    ],
    notices: [
      {
        id: "n1",
        title: "Reunió de tutors",
        body: "Dimarts 17:30. Porta l'agenda si pots.",
        date: "2026-03-10",
        author: "Tutor/a",
        unread: true,
      },
      {
        id: "n2",
        title: "Sortida cultural",
        body: "Autorització pendent per al museu.",
        date: "2026-03-08",
        author: "Cap d'estudis",
      },
    ],
    absences: [
      {
        id: "a1",
        date: "2026-03-09",
        subject: "Matemàtiques",
        kind: "retard",
        justified: false,
        comment: "5 minuts",
      },
      {
        id: "a2",
        date: "2026-03-02",
        subject: "Educació Física",
        kind: "falta",
        justified: true,
        comment: "Visita mèdica",
      },
    ],
    grades: [
      {
        id: "g1",
        subject: "Valencià",
        evaluation: "2a avaluació",
        value: "8",
        comment: "Bona expressió oral",
      },
      {
        id: "g2",
        subject: "Matemàtiques",
        evaluation: "2a avaluació",
        value: "7",
      },
      {
        id: "g3",
        subject: "Anglès",
        evaluation: "2a avaluació",
        value: "9",
      },
    ],
    messages: [
      {
        id: "m1",
        subject: "Treball de sintet",
        from: "Departament de Ciències",
        date: "2026-03-07",
        preview: "Recordeu lliurar el dossier abans de divendres.",
        unread: true,
      },
    ],
    activities: [
      {
        id: "act1",
        title: "Jornada de portes obertes",
        date: "2026-03-21",
        place: "Pavelló",
        description: "Horari 10:00–13:00",
      },
    ],
    behaviors: [
      {
        id: "b1",
        date: "2026-02-28",
        subject: "Tutoria",
        description: "Col·laboració a l'aula",
        kind: "positiu",
      },
    ],
  };
}
