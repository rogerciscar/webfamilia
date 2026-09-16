import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { access, chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

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
  backend: "postgres" | "file";
};

export type StorageInfo = {
  backend: "postgres" | "file" | "none";
  persistent: boolean;
  hasVaultSecret: boolean;
};

const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
    })
  : null;

let pgReady: Promise<void> | null = null;

function ensurePg() {
  if (!pool) return null;
  if (!pgReady) {
    pgReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS pont_vault (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        pgReady = null;
        throw err;
      });
  }
  return pgReady;
}

export function getStorageInfo(): StorageInfo {
  const hasVaultSecret = Boolean(
    process.env.PONT_VAULT_SECRET && process.env.PONT_VAULT_SECRET.length >= 8,
  );
  if (pool) {
    return { backend: "postgres", persistent: true, hasVaultSecret };
  }
  const onVolume = Boolean(
    process.env.PONT_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH,
  );
  return {
    backend: "file",
    persistent: onVolume || !process.env.RAILWAY_ENVIRONMENT,
    hasVaultSecret,
  };
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

/** Stable secret across deploys when PONT_VAULT_SECRET is set. */
async function readDeviceKey(): Promise<Buffer> {
  const fromEnv = process.env.PONT_VAULT_SECRET;
  if (fromEnv && fromEnv.length >= 8) {
    return createHash("sha256").update(`pont-device:${fromEnv}`).digest();
  }
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

async function readVaultFile(): Promise<VaultFile | null> {
  if (pool) {
    await ensurePg();
    const res = await pool!.query(
      `SELECT payload FROM pont_vault WHERE id = $1 LIMIT 1`,
      ["default"],
    );
    if (!res.rows[0]) return null;
    return res.rows[0].payload as VaultFile;
  }
  try {
    await access(VAULT_PATH);
    const raw = await readFile(VAULT_PATH, "utf8");
    return JSON.parse(raw) as VaultFile;
  } catch {
    return null;
  }
}

async function writeVaultFile(file: VaultFile) {
  if (pool) {
    await ensurePg();
    await pool!.query(
      `
      INSERT INTO pont_vault (id, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      `,
      ["default", JSON.stringify(file)],
    );
    return;
  }
  await ensureDataDir();
  await writeFile(VAULT_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
  try {
    await chmod(VAULT_PATH, 0o600);
  } catch {
    // ignore
  }
}

export async function vaultExists() {
  return Boolean(await readVaultFile());
}

export async function peekVaultMeta(): Promise<VaultMeta | null> {
  const file = await readVaultFile();
  if (!file) return null;
  return {
    username: file.username,
    updatedAt: file.updatedAt,
    mode: file.mode ?? "master",
    backend: pool ? "postgres" : "file",
  };
}

export async function saveCredentials(
  credentials: StoredCredentials,
  options: { mode: "device" | "master"; masterPassword?: string },
) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const secret =
    options.mode === "device" ? await readDeviceKey() : options.masterPassword;
  if (!secret || (typeof secret === "string" && secret.length < 8)) {
    throw new Error("Cal una contrasenya mestra d'almenys 8 caràcters.");
  }
  if (
    options.mode === "device" &&
    process.env.RAILWAY_ENVIRONMENT &&
    !process.env.PONT_VAULT_SECRET &&
    !pool &&
    !process.env.PONT_DATA_DIR &&
    !process.env.RAILWAY_VOLUME_MOUNT_PATH
  ) {
    // Still save, but caller should warn: ephemeral disk without secret/db/volume.
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
  await writeVaultFile(file);
}

export async function loadCredentials(masterPassword?: string): Promise<StoredCredentials> {
  const file = await readVaultFile();
  if (!file) throw new Error("No hi ha credencials desades.");
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
        : "No s'han pogut llegir les credencials desades. Si ets a Railway, configura PONT_VAULT_SECRET i Postgres.",
    );
  }
}

export async function clearCredentials() {
  if (pool) {
    try {
      await ensurePg();
      await pool.query(`DELETE FROM pont_vault WHERE id = $1`, ["default"]);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await unlink(VAULT_PATH);
  } catch {
    // already gone
  }
}
