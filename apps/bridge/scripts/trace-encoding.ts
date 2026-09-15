import * as cheerio from "cheerio";

const res = await fetch("https://familia.edu.gva.es/wf-front/myitaca/login_wf?idioma=v");
const jarCookies = res.headers.getSetCookie?.() ?? [];
await res.arrayBuffer();
const cookie = jarCookies.map((c) => c.split(";")[0]).join("; ");
const post = await fetch("https://familia.edu.gva.es/wf-front/myitaca/main_wf", {
  method: "POST",
  redirect: "manual",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    cookie,
    origin: "https://familia.edu.gva.es",
    referer: "https://familia.edu.gva.es/wf-front/myitaca/login_wf",
  },
  body: new URLSearchParams({
    documento: "00000000T",
    contrasenya: "wrong",
    idioma: "V",
    loginParam: "",
  }),
});
const set2 = post.headers.getSetCookie?.() ?? [];
const cookie2 = [...jarCookies, ...set2].map((c) => c.split(";")[0]).join("; ");
const final = await fetch(post.headers.get("location")!, { headers: { cookie: cookie2 } });
const fbuf = Buffer.from(await final.arrayBuffer());
const latin1 = fbuf.toString("latin1");
console.log("h2 raw", latin1.match(/<h2>.*?<\/h2>/)?.[0]);
const $ = cheerio.load(latin1);
const text = $("h2").first().text();
console.log("cheerio", text);
console.log("bytes", Buffer.from(text, "utf8"));
