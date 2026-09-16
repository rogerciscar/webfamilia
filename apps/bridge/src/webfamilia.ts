import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

export const WF_BASE = "https://familia.edu.gva.es/wf-front";
export const WF_LOGIN = `${WF_BASE}/myitaca/login_wf`;
export const WF_MAIN = `${WF_BASE}/myitaca/main_wf`;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type FetchResult = {
  url: string;
  status: number;
  html: string;
  title: string;
};

function jarToHeader(jar: CookieJar, url: string) {
  return jar.getCookieStringSync(url);
}

async function storeSetCookies(jar: CookieJar, url: string, headers: Headers) {
  const raw = headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    try {
      await jar.setCookie(cookie, url);
    } catch {
      // ignore malformed cookies
    }
  }
}

async function readHtml(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("latin1");
}

export class WebFamiliaClient {
  jar = new CookieJar();
  lastHtml = "";
  lastUrl = "";
  username = "";

  async login(username: string, password: string, idioma: "V" | "C" = "V") {
    this.username = username.trim().toUpperCase();
    await this.get(`${WF_LOGIN}?idioma=${idioma.toLowerCase()}`, {
      allowLoginPage: true,
    });
    const body = new URLSearchParams({
      documento: this.username,
      contrasenya: password,
      idioma,
      loginParam: "",
    });
    const res = await fetch(WF_MAIN, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: jarToHeader(this.jar, WF_MAIN),
        origin: "https://familia.edu.gva.es",
        referer: `${WF_LOGIN}?idioma=${idioma.toLowerCase()}`,
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ca-ES,ca;q=0.9,es;q=0.8",
      },
      body,
    });
    await storeSetCookies(this.jar, WF_MAIN, res.headers);
    const location = res.headers.get("location");
    let page: FetchResult;
    if (location) {
      const next = new URL(location, WF_MAIN).toString();
      page = await this.get(next, { allowLoginPage: true });
    } else {
      const html = await readHtml(res);
      this.lastHtml = html;
      this.lastUrl = WF_MAIN;
      page = {
        url: WF_MAIN,
        status: res.status,
        html,
        title: cheerio.load(html)("title").text().trim(),
      };
    }
    if (isLoginFailure(page)) {
      throw new Error(loginErrorMessage(page.html));
    }
    if (isLopdPage(page.html)) {
      // Best-effort accept; if it fails we still keep the session page.
      page = await this.acceptLopdIfPresent(page);
    }
    if (isLoginFailure(page)) {
      throw new Error(loginErrorMessage(page.html));
    }
    return page;
  }

  async acceptLopdIfPresent(page: FetchResult): Promise<FetchResult> {
    const $ = cheerio.load(page.html);
    const form = $("form").first();
    if (!form.length) return page;
    const action = form.attr("action") || page.url;
    const actionUrl = new URL(action, page.url).toString();
    const params = new URLSearchParams();
    form.find("input").each((_, el) => {
      const name = $(el).attr("name");
      if (!name) return;
      const type = ($(el).attr("type") || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") {
        params.set(name, $(el).attr("value") || "on");
        return;
      }
      params.set(name, $(el).attr("value") || "");
    });
    if (![...params.keys()].length) return page;
    const res = await fetch(actionUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: jarToHeader(this.jar, actionUrl),
        origin: "https://familia.edu.gva.es",
        referer: page.url,
        "user-agent": BROWSER_UA,
      },
      body: params,
    });
    await storeSetCookies(this.jar, actionUrl, res.headers);
    const location = res.headers.get("location");
    if (location) {
      return this.get(new URL(location, actionUrl).toString(), {
        allowLoginPage: true,
      });
    }
    const html = await readHtml(res);
    this.lastHtml = html;
    this.lastUrl = actionUrl;
    return {
      url: actionUrl,
      status: res.status,
      html,
      title: cheerio.load(html)("title").text().trim(),
    };
  }

  async get(
    pathOrUrl: string,
    opts: { allowLoginPage?: boolean } = {},
  ): Promise<FetchResult> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${WF_BASE}/myitaca/${pathOrUrl.replace(/^\//, "")}`;
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        cookie: jarToHeader(this.jar, url),
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ca-ES,ca;q=0.9,es;q=0.8",
      },
    });
    await storeSetCookies(this.jar, url, res.headers);
    const html = await readHtml(res);
    this.lastHtml = html;
    this.lastUrl = res.url;
    if (!opts.allowLoginPage && isLoginFailure({ url: res.url, html })) {
      throw new Error("Sessió caducada o no autenticada.");
    }
    return {
      url: res.url,
      status: res.status,
      html,
      title: cheerio.load(html)("title").text().trim(),
    };
  }

  isAuthenticated() {
    return Boolean(this.lastHtml) && !isLoginFailure({
      url: this.lastUrl,
      html: this.lastHtml,
    });
  }
}

export function isLopdPage(html: string) {
  return /lopd|protecci[oó]n de datos|protecci[oó] de dades|tractament de dades|aceptar.*condiciones|acceptar.*condicions/i.test(
    html,
  ) && /<form/i.test(html);
}

export function isLoginFailure(page: Pick<FetchResult, "url" | "html">) {
  const onLoginUrl = /login_wf/i.test(page.url);
  const hasLoginForm =
    /id=["']imc-form-login["']|name=["']form_login["']/i.test(page.html);
  const hasErrorHeading =
    /<h2[^>]*>\s*S['']ha produ[iï]t un error en l['']acc[eé]s\s*<\/h2>/i.test(
      page.html,
    ) ||
    /<h2[^>]*>\s*Se ha producido un error en el acceso\s*<\/h2>/i.test(page.html);
  if (hasErrorHeading) return true;
  if (onLoginUrl && hasLoginForm) return true;
  if (onLoginUrl && /session_expired/i.test(page.url)) return true;
  return false;
}

export function looksLikeLogin(html: string) {
  return isLoginFailure({ url: "", html });
}

export function loginErrorMessage(html: string) {
  const $ = cheerio.load(html);
  const heading = $("h2").first().text().replace(/\s+/g, " ").trim();
  if (/error/i.test(heading)) return heading;
  if (/session_expired|caduc/i.test(html)) {
    return "Sessió caducada al portal oficial. Torna-ho a provar.";
  }
  return "Login rebutjat per Web Família. Revisa usuari/contrasenya o accepta la LOPD al portal oficial una primera vegada.";
}

export function extractNavLinks(html: string) {
  const $ = cheerio.load(html);
  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || href === "#" || href.startsWith("javascript:")) return;
    links.push({ href, text: text || href });
  });
  $("[onclick]").each((_, el) => {
    const onclick = $(el).attr("onclick") || "";
    const m =
      onclick.match(/(?:location(?:\.href)?|document\.location)\s*=\s*['"]([^'"]+)['"]/i) ||
      onclick.match(/window\.open\(\s*['"]([^'"]+)['"]/i);
    if (!m) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    links.push({ href: m[1], text: text || m[1] });
  });
  $("[data-href], [data-url], [data-link]").each((_, el) => {
    const href =
      $(el).attr("data-href") || $(el).attr("data-url") || $(el).attr("data-link") || "";
    if (!href) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    links.push({ href, text: text || href });
  });
  return uniqueBy(links, (l) => `${l.href}|${l.text}`);
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
