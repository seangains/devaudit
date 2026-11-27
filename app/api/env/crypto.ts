import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM: a 12-byte random IV and a 16-byte auth tag per value, both stored alongside the
// ciphertext (not secret on their own) so nothing but ENV_VARS_ENCRYPTION_KEY needs protecting.
//
// TWO STORED FORMATS (decryptValue reads both, encryptValue only writes the new one):
//   legacy: base64(iv || authTag || ciphertext)               — no context binding
//   v2:     "v2:" + base64(iv || authTag || ciphertext)       — bound to a context string (AAD)
//
// WHY v2: without context binding, a ciphertext is valid ANYWHERE. Someone who can read project A's
// rows could copy an encrypted value into a project they control and get it decrypted-and-deployed
// there. v2 binds each value to "which project and which variable name" using GCM's additional
// authenticated data, so a copied value fails authentication in any other place. Legacy rows keep
// working; each one upgrades to v2 the next time it's saved.
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const V2_PREFIX = "v2:";

function getKey(): Buffer {
  const raw = process.env.ENV_VARS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENV_VARS_ENCRYPTION_KEY is not configured on the server. Generate one with " +
        "`openssl rand -base64 32` and set it as an environment variable (keep it out of git).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENV_VARS_ENCRYPTION_KEY must be a base64 string that decodes to exactly 32 bytes.");
  }
  return key;
}

/** The context a stored value is bound to. Use the same call when encrypting and decrypting. */
export function envVarAad(projectId: string, key: string): string {
  return `project_env_vars:${projectId}:${key}`;
}

/** Encrypts one env var value, bound to `aad` (see envVarAad). Returns "v2:" + base64(iv || tag || ciphertext). */
export function encryptValue(plaintext: string, aad: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return V2_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Decrypts a value produced by encryptValue. `aad` is REQUIRED for v2 values (they refuse to
 *  decrypt without the matching context) and ignored for legacy values. Not called in the env
 *  route on purpose — only the deploy step needs a real value, server-side. */
export function decryptValue(stored: string, aad?: string): string {
  const isV2 = stored.startsWith(V2_PREFIX);
  if (isV2 && !aad) throw new Error("Context is required to decrypt this value.");

  const key = getKey();
  const raw = Buffer.from(isV2 ? stored.slice(V2_PREFIX.length) : stored, "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new Error("Stored value is malformed.");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  if (isV2) decipher.setAAD(Buffer.from(aad as string, "utf8"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
