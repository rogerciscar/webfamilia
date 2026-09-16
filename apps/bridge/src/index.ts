import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  forgetCredentials,
  getCaptureHtml,
  getCaptures,
  getDashboard,
  getStatus,
  getStructureReport,
  loginLive,
  rescanLive,
  tryAutoLogin,
  unlockAndLogin,
  useMock,
} from "./session";
import { getStorageInfo } from "./vault";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveWebRoot() {
  const candidates = [
    path.resolve(__dirname, "../public"),
    path.resolve(process.cwd(), "apps/bridge/public"),
    path.resolve(process.cwd(), "public"),
    path.resolve(__dirname, "../../web/dist"),
    path.resolve(process.cwd(), "apps/web/dist"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

const webRootAbs = resolveWebRoot();
const webRootRel = webRootAbs
  ? path.relative(process.cwd(), webRootAbs) || "."
  : null;

const app = new Hono();
const port = Number(process.env.PORT ?? 8787);

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
  }),
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "webfamilia-app",
    web: Boolean(webRootAbs),
    webRoot: webRootAbs,
    storage: getStorageInfo(),
  }),
);

app.get("/api/session", async (c) => {
  const auto = await tryAutoLogin();
  const session = await getStatus();
  if (auto && session.authenticated) {
    return c.json({ ...session, dashboard: auto });
  }
  return c.json(session);
});

app.post("/api/session/mock", async (c) => {
  const dashboard = useMock();
  return c.json({ ok: true, dashboard, session: await getStatus() });
});

const loginSchema = z.object({
  username: z.string().trim().min(3),
  password: z.string().min(1),
  remember: z.boolean().optional().default(true),
  protectWithMaster: z.boolean().optional().default(false),
  masterPassword: z.union([z.string().min(8), z.literal(""), z.undefined()]).optional(),
  idioma: z.enum(["V", "C"]).optional(),
});

function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.map((i) => i.message).join("; ") || "Dades de login invàlides";
  }
  if (error instanceof Error) return error.message;
  return "Error de login";
}

app.post("/api/session/login", async (c) => {
  try {
    const body = loginSchema.parse(await c.req.json());
    const masterPassword =
      body.masterPassword && body.masterPassword.length >= 8
        ? body.masterPassword
        : undefined;
    if (body.protectWithMaster && !masterPassword) {
      return c.json(
        { ok: false, error: "Cal contrasenya mestra si actives la protecció extra." },
        400,
      );
    }
    const dashboard = await loginLive({ ...body, masterPassword });
    return c.json({ ok: true, dashboard, session: await getStatus() });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error) }, 400);
  }
});

const unlockSchema = z.object({
  masterPassword: z.string().min(8).optional(),
});

app.post("/api/session/unlock", async (c) => {
  try {
    const body = unlockSchema.parse(await c.req.json().catch(() => ({})));
    const dashboard = await unlockAndLogin(body.masterPassword);
    return c.json({ ok: true, dashboard, session: await getStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No s'ha pogut desbloquejar";
    return c.json({ ok: false, error: message }, 400);
  }
});

app.post("/api/session/forget", async (c) => {
  await forgetCredentials();
  return c.json({ ok: true, session: await getStatus() });
});

app.get("/api/dashboard", async (c) => {
  try {
    return c.json(await getDashboard());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al dashboard";
    return c.json({ ok: false, error: message }, 400);
  }
});

app.get("/api/debug/captures", (c) => c.json(getCaptures()));

app.get("/api/debug/captures/:key", (c) => {
  const html = getCaptureHtml(c.req.param("key"));
  if (!html) return c.text("Not found", 404);
  return c.html(html);
});

app.get("/api/admin/structure", (c) => {
  const structure = getStructureReport();
  if (!structure) return c.json({ ok: false, error: "Encara no hi ha estructura. Fes login o Rescanejar." }, 404);
  return c.json({ ok: true, structure, captures: getCaptures() });
});

app.post("/api/admin/scrape", async (c) => {
  try {
    const result = await rescanLive();
    return c.json({ ok: true, ...result, session: await getStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de scrape";
    return c.json({ ok: false, error: message }, 400);
  }
});

if (webRootAbs && webRootRel) {
  app.use("/*", serveStatic({ root: webRootRel }));
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.text("Not found", 404);
    const html = await readFile(path.join(webRootAbs, "index.html"), "utf8");
    return c.html(html);
  });
} else {
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return c.html(
      `<!doctype html><html lang="ca"><body style="font-family:system-ui;padding:2rem">
        <h1>Pont</h1>
        <p>La webapp no s'ha construït en aquest deploy.</p>
        <p>Revisa els logs de build a Railway: ha de existir <code>apps/bridge/public/index.html</code>.</p>
        <p><a href="/api/health">/api/health</a></p>
      </body></html>`,
      500,
    );
  });
}

console.log(
  `WebFamilia listening on 0.0.0.0:${port} · web=${webRootAbs ?? "MISSING"}`,
);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
