import {
  clearCredentials,
  loadCredentials,
  peekVaultMeta,
  saveCredentials,
  vaultExists,
} from "../src/vault";

const DATA = { username: "12345678Z", password: "secret-pass" };

await clearCredentials();
await saveCredentials(DATA, { mode: "device" });
console.log("exists", await vaultExists());
console.log("meta", await peekVaultMeta());
const loaded = await loadCredentials();
console.log("loaded", loaded);
if (loaded.username !== DATA.username || loaded.password !== DATA.password) {
  throw new Error("device vault roundtrip failed");
}
await clearCredentials();
console.log("device vault ok");
