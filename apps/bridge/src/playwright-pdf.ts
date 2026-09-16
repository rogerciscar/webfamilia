import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { WF_LOGIN } from "./webfamilia";

export type CapturedPdf = {
  buffer: Buffer;
  url: string;
  filenameHint?: string;
};

type PdfHit = { url: string; buffer: Buffer };

/**
 * Playwright session for Web Família + SharePoint PDFs.
 * Cheerio/fetch cannot auth to SharePoint; browser cookies can.
 */
export class PlaywrightPdfSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private hits: PdfHit[] = [];
  private started = false;

  async start(username: string, password: string) {
    if (this.started) return;
    this.browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    this.context = await this.browser.newContext({ acceptDownloads: true });
    this.page = await this.context.newPage();
    this.attachHitListener(this.page);
    const loginUrl = `${WF_LOGIN}?idioma=c`;
    await this.page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await this.page.fill("#usuario, input[name=documento]", username.trim().toUpperCase());
    await this.page.fill("#contrasenya, input[name=contrasenya]", password);
    await this.page.click("#bt_envia, button[type=submit]");
    await this.page.waitForURL(/listar_alumnos_wf|alumno|main_wf/i, { timeout: 45000 });
    await dismissModals(this.page);
    this.started = true;
  }

  private attachHitListener(page: Page) {
    page.on("response", async (res) => {
      try {
        const ct = (res.headers()["content-type"] || "").toLowerCase();
        const url = res.url();
        if (!ct.includes("application/pdf") && !/download\.aspx|\.pdf(\?|$)/i.test(url)) return;
        const buf = Buffer.from(await res.body());
        if (buf.length > 1000 && buf.subarray(0, 4).toString() === "%PDF") {
          this.hits.push({ url, buffer: buf });
        }
      } catch {
        // aborted / navigation race
      }
    });
  }

  /** Open aviso detail and capture any PDF (SharePoint included). */
  async downloadFromDetail(opts: {
    detailUrl: string;
    linkHref?: string;
    linkText?: string;
    noticeTitle?: string;
  }): Promise<CapturedPdf | null> {
    if (!this.page || !this.context) throw new Error("Playwright no iniciat");
    const before = this.hits.length;
    const page = this.page;
    await page.goto(opts.detailUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(800);
    await dismissModals(page);

    const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);

    let clicked = false;
    if (opts.linkHref) {
      const byHref = page.locator(`a[href="${cssEscape(opts.linkHref)}"]`).first();
      if (await byHref.count()) {
        await byHref.click({ timeout: 8000 }).catch(() => undefined);
        clicked = true;
      }
      if (!clicked) {
        const partial = page.locator(`a[href*="sharepoint"], a[href*=".pdf"], a[href*="download"]`).first();
        if (await partial.count()) {
          await partial.click({ timeout: 8000 }).catch(() => undefined);
          clicked = true;
        }
      }
    }
    if (!clicked && opts.linkText) {
      const byText = page.getByText(new RegExp(escapeRe(opts.linkText.slice(0, 40)), "i")).first();
      if (await byText.count()) {
        await byText.click({ timeout: 8000 }).catch(() => undefined);
        clicked = true;
      }
    }
    if (!clicked && opts.noticeTitle) {
      const titleHit = page.getByText(new RegExp(escapeRe(opts.noticeTitle.slice(0, 40)), "i")).first();
      if (await titleHit.count()) {
        await titleHit.click({ timeout: 8000 }).catch(() => undefined);
        clicked = true;
      }
    }
    const dlBtn = page.getByRole("link", { name: /descarg|download|\.pdf/i }).first();
    if (await dlBtn.count()) {
      await dlBtn.click().catch(() => undefined);
    }

    const download = await downloadPromise;
    if (download) {
      const fail = await download.failure().catch(() => null);
      if (!fail) {
        const stream = await download.createReadStream();
        if (stream) {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const buffer = Buffer.concat(chunks);
          if (buffer.length > 100 && buffer.subarray(0, 4).toString() === "%PDF") {
            return {
              buffer,
              url: download.url(),
              filenameHint: download.suggestedFilename(),
            };
          }
        }
      }
    }

    await page.waitForTimeout(2000);
    const fresh = this.hits.slice(before);
    if (fresh.length) return pickBestPdf(fresh, opts.noticeTitle || opts.linkText);

    // SharePoint link on page
    const sp = page.locator('a[href*="sharepoint.com"]').first();
    if (await sp.count()) {
      const href = await sp.getAttribute("href");
      if (href) {
        const viaSp = await this.downloadByNavigating(href, opts.noticeTitle);
        if (viaSp) return viaSp;
      }
    }
    if (opts.linkHref && /sharepoint|\.pdf/i.test(opts.linkHref)) {
      return this.downloadByNavigating(opts.linkHref, opts.noticeTitle);
    }
    return null;
  }

  /** Navigate agenda and click a notice row by title (Menú menjador pattern). */
  async downloadByNoticeTitle(titleRe: RegExp, agendaUrl?: string): Promise<CapturedPdf | null> {
    if (!this.page) throw new Error("Playwright no iniciat");
    const before = this.hits.length;
    const page = this.page;
    const url =
      agendaUrl ||
      "https://familia.edu.gva.es/wf-front/myitaca/alumno_avisos_wf?tipo=ag";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    await dismissModals(page);
    const row = page.getByText(titleRe).first();
    if (!(await row.count())) return null;
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await row.click({ timeout: 15000 });
    await page.waitForTimeout(2000);
    const dlBtn = page.getByRole("link", { name: /descarg|download|\.pdf/i }).first();
    if (await dlBtn.count()) await dlBtn.click().catch(() => undefined);
    const download = await downloadPromise;
    if (download) {
      const stream = await download.createReadStream().catch(() => null);
      if (stream) {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 100 && buffer.subarray(0, 4).toString() === "%PDF") {
          return {
            buffer,
            url: download.url(),
            filenameHint: download.suggestedFilename(),
          };
        }
      }
    }
    const fresh = this.hits.slice(before);
    if (fresh.length) return pickBestPdf(fresh, titleRe.source);
    const sp = page.locator('a[href*="sharepoint.com"]').first();
    if (await sp.count()) {
      const href = await sp.getAttribute("href");
      if (href) return this.downloadByNavigating(href);
    }
    return null;
  }

  private async downloadByNavigating(href: string, hint?: string): Promise<CapturedPdf | null> {
    if (!this.context) return null;
    const before = this.hits.length;
    const p2 = await this.context.newPage();
    this.attachHitListener(p2);
    try {
      const downloadPromise = p2.waitForEvent("download", { timeout: 20000 }).catch(() => null);
      await p2.goto(href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await p2.waitForTimeout(1500);
      const dlBtn = p2.getByRole("link", { name: /descarg|download|\.pdf/i }).first();
      if (await dlBtn.count()) await dlBtn.click().catch(() => undefined);
      const download = await downloadPromise;
      if (download) {
        const stream = await download.createReadStream().catch(() => null);
        if (stream) {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const buffer = Buffer.concat(chunks);
          if (buffer.length > 100 && buffer.subarray(0, 4).toString() === "%PDF") {
            return {
              buffer,
              url: download.url(),
              filenameHint: download.suggestedFilename(),
            };
          }
        }
      }
      const fresh = this.hits.slice(before);
      if (fresh.length) return pickBestPdf(fresh, hint);
      return null;
    } finally {
      await p2.close().catch(() => undefined);
    }
  }

  async close() {
    this.started = false;
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
    this.hits = [];
  }
}

export async function withPlaywrightPdfSession<T>(
  username: string,
  password: string,
  fn: (session: PlaywrightPdfSession) => Promise<T>,
): Promise<T> {
  const session = new PlaywrightPdfSession();
  try {
    await session.start(username, password);
    return await fn(session);
  } finally {
    await session.close();
  }
}

function pickBestPdf(hits: PdfHit[], hint?: string): CapturedPdf {
  const sorted = [...hits].sort((a, b) => b.buffer.length - a.buffer.length);
  const pick =
    (hint &&
      sorted.find((p) =>
        new RegExp(escapeRe(hint.slice(0, 24)), "i").test(p.url),
      )) ||
    sorted.find((p) => /setembr|septiem|menu|men[uú]|menjador/i.test(p.url)) ||
    sorted[0];
  return {
    buffer: pick.buffer,
    url: pick.url,
    filenameHint: pick.url.split("/").pop()?.split("?")[0],
  };
}

async function dismissModals(page: Page) {
  for (const label of ["Aceptar", "Acceptar", "Cerrar", "Tancar", "OK", "Continuar"]) {
    const btn = page.getByRole("button", { name: label });
    if (await btn.count()) {
      await btn.first().click().catch(() => undefined);
      break;
    }
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
