import { WebFamiliaClient } from "../src/webfamilia.ts";

const client = new WebFamiliaClient();
try {
  await client.login("00000000T", "wrong", "V");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log("msg:", msg);
  console.log("bytes:", Buffer.from(msg, "utf8"));
}
