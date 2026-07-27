// ---------------------------------------------------------------------------
// Licence key primitives — generation, hashing, normalisation.
//
// Deliberately separate from `licence.ts` (which performs redemption against
// the database). These are pure functions with no I/O, so they can be unit
// tested without a Postgres instance and reused by the key-generation CLI.
//
// Security properties:
//   - Only a SHA-256 hash is ever stored; a database leak cannot be turned
//     into free subscriptions.
//   - A short plaintext prefix is kept for support lookups ("my key starts
//     with QA-7F3K") without revealing the secret.
// ---------------------------------------------------------------------------
import { createHash, randomBytes } from "crypto";

/** Unambiguous alphabet: no 0/O or 1/I/L to survive being read over the phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 3;
const GROUP_LEN = 4;

export function generateLicenceKey(): { key: string; keyHash: string; keyPrefix: string } {
  // rejection-free modulo bias is acceptable here: 256 % 31 skews by <2%,
  // and the keyspace (31^12 ≈ 7.9e17) is far beyond brute-force via Telegram.
  const bytes = randomBytes(GROUPS * GROUP_LEN);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) groups.push(chars.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(""));
  const key = groups.join("-");
  return { key, keyHash: hashKey(key), keyPrefix: groups[0] };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(normaliseKey(key)).digest("hex");
}

/** Users paste keys with stray spaces, lowercase, em dashes, or Arabic digits. */
export function normaliseKey(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, "")
    .replace(/[—–]/g, "-")
    .toUpperCase();
}
