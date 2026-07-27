// ---------------------------------------------------------------------------
// Licence key tests (pure functions only — redemption needs a database and is
// covered by the integration suite).
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";

import { generateLicenceKey, hashKey, normaliseKey } from "../licence-key";

test("generated keys use the readable format and alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const { key } = generateLicenceKey();
    assert.match(key, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Ambiguous glyphs must never appear — keys get read aloud and retyped.
    assert.ok(!/[01OIL]/.test(key), `ambiguous character in ${key}`);
  }
});

test("keys are unique across generations", () => {
  const seen = new Set(Array.from({ length: 500 }, () => generateLicenceKey().key));
  assert.equal(seen.size, 500);
});

test("the plaintext key is never recoverable from what we store", () => {
  const { key, keyHash, keyPrefix } = generateLicenceKey();
  assert.notEqual(keyHash, key);
  assert.equal(keyHash.length, 64);
  // The support prefix reveals only the first group.
  assert.equal(keyPrefix, key.split("-")[0]);
  assert.ok(!keyHash.includes(key));
});

test("hashing is stable and matches the stored hash", () => {
  const { key, keyHash } = generateLicenceKey();
  assert.equal(hashKey(key), keyHash);
  assert.equal(hashKey(key), hashKey(key));
});

test("normalisation tolerates how customers actually paste keys", () => {
  const { key, keyHash } = generateLicenceKey();
  const messy = [
    key.toLowerCase(),
    ` ${key} `,
    key.replace(/-/g, "—"), // em dash from copy/paste
    key.split("").join(" ").replace(/\s+/g, " "),
  ];
  for (const variant of messy) {
    assert.equal(hashKey(variant), keyHash, `failed to normalise: ${variant}`);
  }
});

test("Arabic-Indic digits are normalised to ASCII", () => {
  assert.equal(normaliseKey("ABC٢-DEF٣"), "ABC2-DEF3");
});

test("different keys never collide", () => {
  const a = generateLicenceKey();
  const b = generateLicenceKey();
  assert.notEqual(hashKey(a.key), hashKey(b.key));
});
