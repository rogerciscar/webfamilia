import * as cheerio from "cheerio";

export type StructureReport = {
  capturedAt: string;
  pages: {
    key: string;
    bytes: number;
    title: string;
    urlHint?: string;
    markers: string[];
    classes: string[];
    links: { href: string; text: string }[];
    tables: number;
    lists: number;
    sampleText: string[];
  }[];
  totals: {
    pages: number;
    noticesHint: number;
    scheduleHint: number;
    studentHint: number;
  };
};

const MARKERS = [
  "imc-alumno-nombre",
  "imc-alumnos",
  "imc-listado-agenda",
  "imc-avisos-modulo",
  "imc-horarios",
  "imc-materias-tabla",
  "imc-matricula-menu",
  "imc-avisos-menu",
  "bt-comunicaciones",
  "imc-form-login",
  "imc-sesion-caducada",
  "imc-sin-datos",
  "imc-escritorio-alumnos",
];

export function analyzePages(pages: Record<string, string>): StructureReport {
  const analyzed = Object.entries(pages).map(([key, html]) => analyzeOne(key, html));
  return {
    capturedAt: new Date().toISOString(),
    pages: analyzed,
    totals: {
      pages: analyzed.length,
      noticesHint: analyzed.reduce(
        (n, p) => n + (p.markers.includes("imc-listado-agenda") ? 1 : 0),
        0,
      ),
      scheduleHint: analyzed.reduce(
        (n, p) => n + (p.markers.includes("imc-horarios") ? 1 : 0),
        0,
      ),
      studentHint: analyzed.reduce(
        (n, p) => n + (p.markers.includes("imc-alumno-nombre") ? 1 : 0),
        0,
      ),
    },
  };
}

function analyzeOne(key: string, html: string) {
  const $ = cheerio.load(html);
  const classCounts = new Map<string, number>();
  $("[class]").each((_, el) => {
    const cls = ($(el).attr("class") || "").split(/\s+/).filter(Boolean);
    for (const c of cls) {
      if (!c.startsWith("imc-") && !c.startsWith("bt-")) continue;
      classCounts.set(c, (classCounts.get(c) || 0) + 1);
    }
  });
  const classes = [...classCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([c, n]) => `${c}×${n}`);
  const links: { href: string; text: string }[] = [];
  $("a[href], a[data-href]").each((_, el) => {
    const href = (($(el).attr("href") || $(el).attr("data-href") || "") as string).trim();
    if (!href || href === "#" || href.startsWith("javascript:")) return;
    if (!/_wf|myitaca|alumno_|listar_/i.test(href)) return;
    links.push({
      href: href.slice(0, 160),
      text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 80),
    });
  });
  const sampleText = $("h1, h2, h3, .imc-alumno-nombre, strong, .imc-sin-datos")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 2 && t.length < 120)
    .slice(0, 12);
  return {
    key,
    bytes: html.length,
    title: $("title").first().text().replace(/\s+/g, " ").trim(),
    markers: MARKERS.filter((m) => html.includes(m)),
    classes,
    links: uniqueLinks(links).slice(0, 30),
    tables: $("table").length,
    lists: $("ul").length,
    sampleText,
  };
}

function uniqueLinks(links: { href: string; text: string }[]) {
  const seen = new Set<string>();
  return links.filter((l) => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });
}
