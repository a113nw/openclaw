import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CURRENT_VERSION = 1;

export type EncryptedPayload = {
  v: number;
  iv: string;
  ct: string;
  tag: string;
};

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: CURRENT_VERSION,
    iv: iv.toString("base64"),
    ct: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  if (payload.v !== CURRENT_VERSION) {
    throw new Error(`unsupported credential cipher version: ${payload.v}`);
  }
  const iv = Buffer.from(payload.iv, "base64");
  const ct = Buffer.from(payload.ct, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error(`invalid IV length: ${iv.length}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`invalid auth tag length: ${tag.length}`);
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return decrypted.toString("utf8");
}

export function isEncryptedPayload(data: unknown): data is { _encrypted: true; payload: EncryptedPayload } {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  if (record._encrypted !== true) return false;
  const payload = record.payload;
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.v === "number" &&
    typeof p.iv === "string" &&
    typeof p.ct === "string" &&
    typeof p.tag === "string"
  );
}
