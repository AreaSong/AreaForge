import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAiProviderBaseUrl } from "./ai-provider-credential-service";

test("provider URL validation keeps development local testing explicit", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppEnv = process.env.APP_ENV;
  try {
    setEnv("NODE_ENV", "development");
    process.env.APP_ENV = "development";
    assert.equal(validateAiProviderBaseUrl("http://127.0.0.1:9999/v1/"), "http://127.0.0.1:9999/v1");
    assert.throws(() => validateAiProviderBaseUrl("http://provider.example/v1?api_key=leak"), /AI_PROVIDER_BASE_URL_INVALID/);

    setEnv("NODE_ENV", "production");
    process.env.APP_ENV = "production";
    assert.throws(() => validateAiProviderBaseUrl("http://provider.example/v1"), /AI_PROVIDER_BASE_URL_HTTPS_REQUIRED/);
    assert.throws(() => validateAiProviderBaseUrl("https://127.0.0.1:9999/v1"), /AI_PROVIDER_BASE_URL_PRIVATE_HOST/);
    assert.throws(() => validateAiProviderBaseUrl("https://[::1]/v1"), /AI_PROVIDER_BASE_URL_PRIVATE_HOST/);
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("APP_ENV", originalAppEnv);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function setEnv(key: string, value: string): void {
  (process.env as unknown as Record<string, string | undefined>)[key] = value;
}
