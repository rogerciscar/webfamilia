import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";

export const WF_BASE = "https://familia.edu.gva.es/wf-front";
export const WF_LOGIN = `${WF_BASE}/myitaca/login_wf`;
export const WF_MAIN = `${WF_BASE}/myitaca/main_wf`;

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
    await jar.setCookie(cookie, url);
  }
}

async function readHtml(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  // Official pages declare utf-8 but often ship ISO-8859-1 bytes.
  return buf.toString("latin1");
}

export class WebFamiliaClient {
  jar = new CookieJar();
  lastHtml = "";
  lastUrl = "";
  username = "";

  async login(username: string, password: string, idioma: "V" | "C" = "V") {
    this.username = username;
    await this.get(WF_LOGIN + `?idioma=${idioma.toLowerCase()}`, {
      allowLoginPage: true,
    });
    const body = new URLSearchParams({
      documento: username,
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
        referer: WF_LOGIN,
        "user-agent":
          "Mozilla/5.0 (compatible; PontFamilia/0.1; +personal-use-bridge)",
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
    if (looksLikeLogin(page.html) || looksLikeLoginError(page.html)) {
      throw new Error(loginErrorMessage(page.html));
    }
    return page;
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
        "user-agent":
          "Mozilla/5.0 (compatible; PontFamilia/0.1; +personal-use-bridge)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    await storeSetCookies(this.jar, url, res.headers);
    const html = await readHtml(res);
    this.lastHtml = html;
    this.lastUrl = res.url;
    if (!opts.allowLoginPage && looksLikeLogin(html)) {
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
    return Boolean(this.lastHtml) && !looksLikeLogin(this.lastHtml);
  }
}

export function looksLikeLogin(html: string) {
  const $ = cheerio.load(html);
  return (
    $("#imc-form-login").length > 0 ||
    $('form[name="form_login"]').length > 0 ||
    /login_wf\?session_expired/i.test(html)
  );
}

export function looksLikeLoginError(html: string) {
  return /error en l.?acc|error en el acceso|credencial|incorrect/i.test(html);
}

export function loginErrorMessage(html: string) {
  const $ = cheerio.load(html);
  const heading = $("h2, .imc-error, .error").first().text().replace(/\s+/g, " ").trim();
  if (heading) return heading;
  return "Login rebutjat: revisa usuari/contrasenya o acceptació LOPD pendent.";
}

export function extractNavLinks(html: string) {
  const $ = cheerio.load(html);
  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href || !text) return;
    if (!/_wf|myitaca/i.test(href)) return;
    links.push({ href, text });
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
