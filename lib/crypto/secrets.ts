import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret =
    process.env.ESPN_COOKIE_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-insecure-espn-cookie-key";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a string for storage. Returns `iv:authTag:ciphertext` (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid ciphertext payload");
  }
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
