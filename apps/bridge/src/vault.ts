import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PONT_DATA_DIR ?? path.join(__dirname, "../../.data");
const VAULT_PATH = path.join(DATA_DIR, "vault.json");

type VaultFile = {
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  username: string;
  updatedAt: string;
};

export type StoredCredentials = {
  username: string;
  password: string;
};

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function deriveKey(masterPassword: string, salt: Buffer) {
  return scryptSync(masterPassword, salt, 32);
}

export async function vaultExists() {
  try {
    await access(VAULT_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function saveCredentials(
  credentials: StoredCredentials,
  masterPassword: string,
) {
  await ensureDataDir();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(masterPassword, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const file: VaultFile = {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    username: credentials.username,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(VAULT_PATH, JSON.stringify(file, null, 2), "utf8");
}

export async function loadCredentials(masterPassword: string): Promise<StoredCredentials> {
  const raw = await readFile(VAULT_PATH, "utf8");
  const file = JSON.parse(raw) as VaultFile;
  const key = deriveKey(masterPassword, Buffer.from(file.salt, "base64"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(file.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(file.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as StoredCredentials;
}

export async function peekVaultMeta() {
  if (!(await vaultExists())) return null;
  const raw = await readFile(VAULT_PATH, "utf8");
  const file = JSON.parse(raw) as VaultFile;
  return { username: file.username, updatedAt: file.updatedAt };
}
