import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
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

const app = new Hono();
const port = Number(process.env.PORT ?? 8787);

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, service: "pont-bridge" }));

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

app.get("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();
  return c.text("Pont bridge API. Obri el frontend a http://localhost:5173");
});

console.log(`Pont bridge listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
