import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM: a 12-byte random IV and a 16-byte auth tag per value, stored alongside the
// ciphertext (neither is secret on its own) so nothing but SECRETS_ENCRYPTION_KEY needs
// protecting. Generic on purpose — right now the only thing using it is the GitHub access token
// in github_connections (see githubConnections.ts), but reuse it for anything similar later
// rather than writing a second copy of this.
//
// NOTE: if DevAudit already has an equivalent crypto helper somewhere (your example route.ts for
// env vars had one, keyed by ENV_VARS_ENCRYPTION_KEY) — just use that one instead and delete this
// file, updating the import in githubConnections.ts accordingly.

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY is not configured on the server. Generate one with " +
        "`openssl rand -base64 32` and set it as an environment variable (keep it out of git).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SECRETS_ENCRYPTION_KEY must be a base64 string that decodes to exactly 32 bytes.");
  }
  return key;
}

/** Encrypts one secret value. Returns a single base64 string: iv || authTag || ciphertext. */
export function encryptValue(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Decrypts a value produced by encryptValue. */
export function decryptValue(stored: string): string {
  const key = getKey();
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
