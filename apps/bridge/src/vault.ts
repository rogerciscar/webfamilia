import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR =
  process.env.PONT_DATA_DIR ??
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "pont")
    : path.join(__dirname, "../.data"));
const VAULT_PATH = path.join(DATA_DIR, "vault.json");
const DEVICE_KEY_PATH = path.join(DATA_DIR, "device.key");

export type StoredCredentials = {
  username: string;
  password: string;
};

type VaultFile = {
  version: 2;
  mode: "device" | "master";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  username: string;
  updatedAt: string;
};

export type VaultMeta = {
  username: string;
  updatedAt: string;
  mode: "device" | "master";
};

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readDeviceKey(): Promise<Buffer> {
  await ensureDataDir();
  try {
    return await readFile(DEVICE_KEY_PATH);
  } catch {
    const key = randomBytes(32);
    await writeFile(DEVICE_KEY_PATH, key, { mode: 0o600 });
    try {
      await chmod(DEVICE_KEY_PATH, 0o600);
    } catch {
      // best effort
    }
    return key;
  }
}

function deriveKey(secret: string | Buffer, salt: Buffer) {
  return scryptSync(secret, salt, 32);
}

export async function vaultExists() {
  try {
    await access(VAULT_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function peekVaultMeta(): Promise<VaultMeta | null> {
  if (!(await vaultExists())) return null;
  const raw = await readFile(VAULT_PATH, "utf8");
  const file = JSON.parse(raw) as VaultFile;
  return {
    username: file.username,
    updatedAt: file.updatedAt,
    mode: file.mode ?? "master",
  };
}

export async function saveCredentials(
  credentials: StoredCredentials,
  options: { mode: "device" | "master"; masterPassword?: string },
) {
  await ensureDataDir();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const secret =
    options.mode === "device" ? await readDeviceKey() : options.masterPassword;
  if (!secret || (typeof secret === "string" && secret.length < 8)) {
    throw new Error("Cal una contrasenya mestra d'almenys 8 caràcters.");
  }
  const key = deriveKey(secret, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const file: VaultFile = {
    version: 2,
    mode: options.mode,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    username: credentials.username,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(VAULT_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
  try {
    await chmod(VAULT_PATH, 0o600);
  } catch {
    // ignore
  }
}

export async function loadCredentials(masterPassword?: string): Promise<StoredCredentials> {
  const raw = await readFile(VAULT_PATH, "utf8");
  const file = JSON.parse(raw) as VaultFile;
  const mode = file.mode ?? "master";
  const secret = mode === "device" ? await readDeviceKey() : masterPassword;
  if (!secret) {
    throw new Error("Cal la contrasenya mestra per desbloquejar el vault.");
  }
  try {
    const key = deriveKey(secret, Buffer.from(file.salt, "base64"));
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
  } catch {
    throw new Error(
      mode === "master"
        ? "Contrasenya mestra incorrecta."
        : "No s'han pogut llegir les credencials desades en aquest dispositiu.",
    );
  }
}

export async function clearCredentials() {
  try {
    await unlink(VAULT_PATH);
  } catch {
    // already gone
  }
}
