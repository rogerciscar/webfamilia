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
  getCachedDashboard,
  getDashboard,
  getStatus,
  getStructureReport,
  loginLive,
  rescanLive,
  startBackgroundScrape,
  unlockAndLogin,
  useMock,
} from "./session";
import { getStorageInfo } from "./vault";
import { pdfDiskPath } from "./attachments";
import type { Attachment } from "@pont/shared";
import {
  clearBrowserSession,
  createBrowserSession,
  mockAllowed,
  requireBrowserSession,
} from "./browser-session";
import {
  deleteCustomSlot,
  listCustomSlots,
  upsertCustomSlot,
} from "./custom-schedule";
import {
  deleteStudentPhoto,
  photosBackend,
  photosCount,
  readStudentPhoto,
  saveStudentPhoto,
} from "./student-photos";

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

app.get("/api/health", async (c) => {
  const session = await getStatus();
  return c.json({
    ok: true,
    service: "webfamilia-app",
    version: session.version,
    web: Boolean(webRootAbs),
    webRoot: webRootAbs,
    storage: getStorageInfo(),
    allowMock: mockAllowed(),
    envScrape: Boolean(
      (process.env.WF_USER || process.env.PONT_WF_USER) &&
        (process.env.WF_PASS || process.env.PONT_WF_PASS),
    ),
    scrape: session.scrape,
    photos: photosBackend(),
    photosStored: await photosCount(),
  });
});

app.get("/api/session", async (c) => {
  const browser = await requireBrowserSession(c);
  const session = await getStatus({
    browserAuth: Boolean(browser),
    sessionMode: browser?.mode,
  });
  if (browser) {
    const dash = await getDashboard().catch(() => null);
    if (dash) return c.json({ ...session, dashboard: dash });
  }
  return c.json(session);
});

app.post("/api/session/mock", async (c) => {
  if (!mockAllowed()) {
    return c.json({ ok: false, error: "Mode exemple desactivat en producció." }, 403);
  }
  const dashboard = useMock();
  await createBrowserSession("mock", c);
  return c.json({
    ok: true,
    dashboard,
    session: await getStatus({ browserAuth: true, sessionMode: "mock" }),
  });
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
    await createBrowserSession("live", c);
    return c.json({
      ok: true,
      dashboard,
      session: await getStatus({ browserAuth: true, sessionMode: "live" }),
    });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error) }, 400);
  }
});

const unlockSchema = z.object({
  masterPassword: z.string().min(8).optional(),
  password: z.string().min(1).optional(),
});

app.post("/api/session/unlock", async (c) => {
  try {
    const body = unlockSchema.parse(await c.req.json().catch(() => ({})));
    const dashboard = await unlockAndLogin({
      masterPassword: body.masterPassword,
      password: body.password,
    });
    await createBrowserSession("live", c);
    return c.json({
      ok: true,
      dashboard,
      session: await getStatus({ browserAuth: true, sessionMode: "live" }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No s'ha pogut desbloquejar";
    return c.json({ ok: false, error: message }, 400);
  }
});

app.post("/api/session/forget", async (c) => {
  await clearBrowserSession(c);
  await forgetCredentials();
  return c.json({ ok: true, session: await getStatus({ browserAuth: false }) });
});

app.post("/api/session/logout", async (c) => {
  await clearBrowserSession(c);
  return c.json({ ok: true, session: await getStatus({ browserAuth: false }) });
});

app.get("/api/dashboard", async (c) => {
  const browser = await requireBrowserSession(c);
  if (!browser) return c.json({ ok: false, error: "Cal iniciar sessió." }, 401);
  try {
    const refresh = c.req.query("refresh") === "1";
    return c.json(await getDashboard({ refresh }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al dashboard";
    return c.json({ ok: false, error: message }, 400);
  }
});

app.get("/api/debug/captures", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  return c.json(getCaptures());
});

app.get("/api/debug/captures/:key", async (c) => {
  if (!(await requireBrowserSession(c))) return c.text("Unauthorized", 401);
  const html = getCaptureHtml(c.req.param("key"));
  if (!html) return c.text("Not found", 404);
  return c.html(html);
});

app.get("/api/admin/structure", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  const structure = getStructureReport();
  if (!structure) return c.json({ ok: false, error: "Encara no hi ha estructura. Fes login o Rescanejar." }, 404);
  return c.json({ ok: true, structure, captures: getCaptures() });
});

app.post("/api/admin/scrape", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  try {
    const result = await rescanLive();
    return c.json({
      ok: true,
      ...result,
      session: await getStatus({ browserAuth: true, sessionMode: "live" }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de scrape";
    return c.json({ ok: false, error: message }, 400);
  }
});

app.get("/api/attachments/:id", async (c) => {
  if (!(await requireBrowserSession(c))) return c.text("Unauthorized", 401);
  const id = c.req.param("id");
  const dash = getCachedDashboard() ?? (await getDashboard().catch(() => null));
  const att = dash?.attachments?.find((a: Attachment) => a.id === id);
  if (!att) return c.text("Not found", 404);
  const disk = pdfDiskPath(att);
  if (!existsSync(disk)) return c.text("Fitxer no trobat al disc", 404);
  const buf = await readFile(disk);
  return new Response(buf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${att.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=3600",
    },
  });
});

app.get("/api/schedule/custom", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  const studentId = c.req.query("studentId") || undefined;
  return c.json({ ok: true, slots: await listCustomSlots(studentId) });
});

app.post("/api/schedule/custom", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  try {
    const body = z
      .object({
        id: z.string().optional(),
        day: z.string().min(1),
        start: z.string().optional(),
        end: z.string().optional(),
        subject: z.string().min(1),
        studentId: z.string().optional(),
        studentName: z.string().optional(),
      })
      .parse(await c.req.json());
    const slot = await upsertCustomSlot(body);
    const dashboard = await getDashboard();
    return c.json({ ok: true, slot, dashboard });
  } catch (error) {
    return c.json({ ok: false, error: errorMessage(error) }, 400);
  }
});

app.delete("/api/schedule/custom/:id", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  await deleteCustomSlot(c.req.param("id"));
  const dashboard = await getDashboard();
  return c.json({ ok: true, dashboard });
});

app.get("/api/students/:id/photo", async (c) => {
  if (!(await requireBrowserSession(c))) return c.text("Unauthorized", 401);
  const studentId = decodeURIComponent(c.req.param("id"));
  const photo = await readStudentPhoto(studentId);
  if (!photo) return c.text("Not found", 404);
  return new Response(new Uint8Array(photo.buffer), {
    headers: {
      "content-type": photo.mime,
      "cache-control": "private, no-cache, max-age=0",
    },
  });
});

app.post("/api/students/:id/photo", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  try {
    const studentId = decodeURIComponent(c.req.param("id"));
    const form = await c.req.formData();
    const entry = form.get("file") ?? form.get("photo");
    if (!entry || typeof entry === "string") {
      return c.json({ ok: false, error: "Cal una imatge (camp file)." }, 400);
    }
    const buf = Buffer.from(await entry.arrayBuffer());
    const mime = ("type" in entry && entry.type) || "image/jpeg";
    const saved = await saveStudentPhoto({ studentId, buffer: buf, mime: String(mime) });
    const dashboard = await getDashboard({ refresh: false });
    return c.json({
      ok: true,
      dashboard,
      photo: {
        studentId: saved.studentId,
        bytes: saved.bytes,
        mime: saved.mime,
        backend: photosBackend(),
      },
    });
  } catch (error) {
    console.error("[photos] upload failed:", error);
    return c.json({ ok: false, error: errorMessage(error) }, 400);
  }
});

app.delete("/api/students/:id/photo", async (c) => {
  if (!(await requireBrowserSession(c))) return c.json({ ok: false, error: "Cal sessió" }, 401);
  await deleteStudentPhoto(decodeURIComponent(c.req.param("id")));
  const dashboard = await getDashboard();
  return c.json({ ok: true, dashboard });
});

if (webRootAbs && webRootRel) {
  const sendIndex = async (c: any) => {
    const html = await readFile(path.join(webRootAbs, "index.html"), "utf8");
    c.header("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
    c.header("pragma", "no-cache");
    c.header("expires", "0");
    c.header("surrogate-control", "no-store");
    c.header("x-webfamilia-build", "0.2.9");
    return c.html(html);
  };
  // Serve HTML ourselves so browsers never keep a stale shell (old Act./0.2.3).
  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);
  app.use(
    "/*",
    serveStatic({
      root: webRootRel,
      rewriteRequestPath: (p) => (p === "/" || p === "/index.html" ? "/__skip_index__" : p),
    }),
  );
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.text("Not found", 404);
    return sendIndex(c);
  });
} else {
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    return c.html(
      `<!doctype html><html lang="ca"><body style="font-family:system-ui;padding:2rem">
        <h1>WebFamilia</h1>
        <p>La webapp no s'ha construït en aquest deploy.</p>
        <p>Revisa els logs de build a Railway: ha de existir <code>apps/bridge/public/index.html</code>.</p>
        <p><a href="/api/health">/api/health</a></p>
      </body></html>`,
      500,
    );
  });
}

console.log(
  `WebFamilia listening on 0.0.0.0:${port} · web=${webRootAbs ?? "MISSING"} · mock=${mockAllowed()}`,
);
startBackgroundScrape();
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
