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
  loginLive,
  tryAutoLogin,
  unlockAndLogin,
  useMock,
} from "./session";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistAbs = path.resolve(__dirname, "../../web/dist");
const webDistRel = path.relative(process.cwd(), webDistAbs) || ".";
const hasWebDist = existsSync(path.join(webDistAbs, "index.html"));

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
  c.json({ ok: true, service: "pont-bridge", web: hasWebDist }),
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
  username: z.string().min(3),
  password: z.string().min(1),
  remember: z.boolean().optional().default(true),
  protectWithMaster: z.boolean().optional().default(false),
  masterPassword: z.string().min(8).optional(),
  idioma: z.enum(["V", "C"]).optional(),
});

app.post("/api/session/login", async (c) => {
  try {
    const body = loginSchema.parse(await c.req.json());
    if (body.protectWithMaster && !body.masterPassword) {
      return c.json(
        { ok: false, error: "Cal contrasenya mestra si actives la protecció extra." },
        400,
      );
    }
    const dashboard = await loginLive(body);
    return c.json({ ok: true, dashboard, session: await getStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de login";
    return c.json({ ok: false, error: message }, 400);
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

if (hasWebDist) {
  app.use("/*", serveStatic({ root: webDistRel }));
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.text("Not found", 404);
    const html = await readFile(path.join(webDistAbs, "index.html"), "utf8");
    return c.html(html);
  });
} else {
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return c.text(
      "Pont bridge API. En local obri http://localhost:5173. En producció cal `npm run build`.",
    );
  });
}

console.log(
  `Pont bridge listening on :${port} (web: ${hasWebDist ? webDistAbs : "missing"})`,
);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
