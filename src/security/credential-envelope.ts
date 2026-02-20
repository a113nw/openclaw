import { isCredentialEncryptionEnabled } from "./credential-config.js";
import { encrypt, decrypt, isEncryptedPayload, type EncryptedPayload } from "./credential-cipher.js";
import { loadOrCreateMasterKey } from "./master-key.js";

/**
 * Seal (encrypt) a JSON-serializable value if credential encryption is enabled.
 * Returns an encrypted envelope or the original data if disabled.
 * On encryption error, falls back to plaintext with a console warning.
 */
export function sealJson(data: unknown): unknown {
  if (!isCredentialEncryptionEnabled()) return data;
  try {
    const { key } = loadOrCreateMasterKey();
    const plaintext = JSON.stringify(data);
    const payload = encrypt(plaintext, key);
    return { _encrypted: true, payload };
  } catch (err) {
    console.warn("[credential-envelope] encryption failed, writing plaintext:", String(err));
    return data;
  }
}

/**
 * Open (decrypt) a JSON value. If the value is an encrypted envelope, decrypt it.
 * Plaintext values are returned as-is — this always works regardless of feature flag.
 */
export function openJson(data: unknown): unknown {
  if (!isEncryptedPayload(data)) return data;
  const { key } = loadOrCreateMasterKey();
  const plaintext = decrypt(data.payload as EncryptedPayload, key);
  return JSON.parse(plaintext) as unknown;
}
