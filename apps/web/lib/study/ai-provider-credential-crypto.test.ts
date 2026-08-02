import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptAiProviderApiKey,
  encryptAiProviderApiKey,
  fingerprintAiProviderApiKey,
} from "./ai-provider-credential-crypto";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  AI_CREDENTIALS_ENCRYPTION_KEY: process.env.AI_CREDENTIALS_ENCRYPTION_KEY,
};

process.env.DATABASE_URL = "postgresql://crypto-selftest.invalid/areaforge";
process.env.AUTH_SESSION_SECRET = "ai-provider-credential-crypto-selftest-secret";
process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "crypto-selftest-key-with-at-least-32-characters";

test("AI provider credentials use authenticated randomized encryption", () => {
  const first = encryptAiProviderApiKey("sk-test-value");
  const second = encryptAiProviderApiKey("sk-test-value");

  assert.notEqual(first, second);
  assert.doesNotMatch(first, /sk-test-value/);
  assert.equal(decryptAiProviderApiKey(first), "sk-test-value");
  assert.equal(decryptAiProviderApiKey(second), "sk-test-value");
  assert.match(fingerprintAiProviderApiKey("sk-test-value"), /^sha256:[0-9a-f]{64}$/);
});

test("AI provider credential tampering and missing key fail closed", () => {
  const encrypted = encryptAiProviderApiKey("sk-test-value");
  const [version, iv, tag, ciphertext] = encrypted.split(":");
  const tamperedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
  assert.throws(
    () => decryptAiProviderApiKey(`${version}:${iv}:${tamperedTag}:${ciphertext}`),
    /decrypt_failed|invalid_ciphertext/,
  );

  delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  assert.throws(() => encryptAiProviderApiKey("sk-test-value"), /missing_key/);
  process.env.AI_CREDENTIALS_ENCRYPTION_KEY = originalEnv.AI_CREDENTIALS_ENCRYPTION_KEY;
});

test.after(() => {
  restoreEnv("DATABASE_URL", originalEnv.DATABASE_URL);
  restoreEnv("AUTH_SESSION_SECRET", originalEnv.AUTH_SESSION_SECRET);
  restoreEnv("AI_CREDENTIALS_ENCRYPTION_KEY", originalEnv.AI_CREDENTIALS_ENCRYPTION_KEY);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
