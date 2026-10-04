import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AiJsonProvider } from "@areaforge/ai";
import {
  aiProviderPreferenceMaxAgeSeconds,
  getAiProviderPreferenceCookieName,
  getAiProviderPreferenceCookieOptions,
  parseAiProviderPreference,
  readAiProviderPreference,
  serializeAiProviderPreference,
} from "../../apps/web/lib/study/ai-provider-preference";
import {
  resolveAiProviderPrerequisites,
  resolveConfiguredAiProvider,
} from "../../apps/web/lib/study/ai-service";
import { patchAiProviderPreferenceSchema } from "../../apps/web/lib/study/schemas";

const root = process.cwd();
const aiRoutes = [
  "apps/web/app/api/ai/discipline/route.ts",
  "apps/web/app/api/ai/daily-review/route.ts",
  "apps/web/app/api/ai/tomorrow-plan/route.ts",
  "apps/web/app/api/ai/drafts/learning-tree/route.ts",
  "apps/web/app/api/ai/drafts/knowledge-card/route.ts",
  "apps/web/app/api/ai/drafts/plan/route.ts",
  "apps/web/app/api/ai/drafts/motivation/route.ts",
  "apps/web/app/api/simulation/stage-adjustment-drafts/ai/route.ts",
] as const;

assert.deepEqual(parseAiProviderPreference(undefined), {
  externalProviderEnabled: false,
  scope: "current_browser",
});
assert.equal(parseAiProviderPreference("").externalProviderEnabled, false);
assert.equal(parseAiProviderPreference("disabled").externalProviderEnabled, false);
assert.equal(parseAiProviderPreference("true").externalProviderEnabled, false);
assert.equal(parseAiProviderPreference("ENABLED").externalProviderEnabled, false);
assert.equal(parseAiProviderPreference("enabled").externalProviderEnabled, true);
assert.equal(
  readAiProviderPreference({ get: () => ({ value: "malformed" }) }, "af_session")
    .externalProviderEnabled,
  false,
);
assert.equal(serializeAiProviderPreference(false), "disabled");
assert.equal(serializeAiProviderPreference(true), "enabled");
assert.equal(getAiProviderPreferenceCookieName("af_session"), "af_session_ai_provider_v1");
assert.equal(aiProviderPreferenceMaxAgeSeconds, 60 * 60 * 24 * 180);

const originalNodeEnv = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = "production";
  const productionOptions = getAiProviderPreferenceCookieOptions();
  assert.deepEqual(productionOptions, {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    path: "/",
    maxAge: aiProviderPreferenceMaxAgeSeconds,
  });
  assert.equal("domain" in productionOptions, false);

  process.env.NODE_ENV = "development";
  assert.equal(getAiProviderPreferenceCookieOptions().secure, false);
} finally {
  restoreEnv("NODE_ENV", originalNodeEnv);
}

assert.equal(patchAiProviderPreferenceSchema.safeParse({ externalProviderEnabled: true }).success, true);
assert.equal(patchAiProviderPreferenceSchema.safeParse({ externalProviderEnabled: false }).success, true);
assert.equal(patchAiProviderPreferenceSchema.safeParse({}).success, false);
assert.equal(patchAiProviderPreferenceSchema.safeParse({ externalProviderEnabled: "true" }).success, false);
assert.equal(
  patchAiProviderPreferenceSchema.safeParse({ externalProviderEnabled: true, providerKey: "forbidden" }).success,
  false,
);

let providerCalls = 0;
const injectedProvider: AiJsonProvider = {
  externalCall: true,
  async generateJson() {
    providerCalls += 1;
    return { ok: true };
  },
};
const deniedProvider = resolveConfiguredAiProvider("discipline", {
  allowExternalProvider: false,
  provider: injectedProvider,
  userId: "preference-selftest",
});
assert.equal(deniedProvider.provider, undefined);
assert.match(deniedProvider.unavailableReason ?? "", /当前浏览器未开启/);
assert.equal(providerCalls, 0);

const originalAiEnabled = process.env.AI_ENABLED;
const originalSensitiveContext = process.env.AI_ALLOW_SENSITIVE_CONTEXT;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalAuthSessionSecret = process.env.AUTH_SESSION_SECRET;
try {
  process.env.DATABASE_URL = "postgresql://preference-selftest.invalid/areaforge";
  process.env.AUTH_SESSION_SECRET = "v11-ai-provider-preference-selftest-secret";
  process.env.AI_ENABLED = "false";
  const disabledPrerequisites = resolveAiProviderPrerequisites({
    allowExternalProvider: true,
    provider: injectedProvider,
    userId: "preference-selftest",
  });
  assert.equal(disabledPrerequisites.available, false);
  assert.match(disabledPrerequisites.unavailableReason ?? "", /AI_ENABLED=false/);
  const systemDeniedProvider = resolveConfiguredAiProvider("discipline", {
    allowExternalProvider: true,
    provider: injectedProvider,
    userId: "preference-selftest",
  });
  assert.equal(systemDeniedProvider.provider, undefined);
  assert.match(systemDeniedProvider.unavailableReason ?? "", /AI_ENABLED=false/);
  assert.equal(providerCalls, 0);

  process.env.AI_ENABLED = "true";
  process.env.AI_ALLOW_SENSITIVE_CONTEXT = "false";
  assert.equal(resolveAiProviderPrerequisites({
    allowExternalProvider: true,
    provider: injectedProvider,
    userId: "preference-selftest",
  }).available, true);
  const allowedProvider = resolveConfiguredAiProvider("discipline", {
    allowExternalProvider: true,
    provider: injectedProvider,
    userId: "preference-selftest",
  });
  assert.equal(allowedProvider.provider, injectedProvider);
  await allowedProvider.provider?.generateJson({ kind: "discipline", context: {} });
  assert.equal(providerCalls, 1);
} finally {
  restoreEnv("AI_ENABLED", originalAiEnabled);
  restoreEnv("AI_ALLOW_SENSITIVE_CONTEXT", originalSensitiveContext);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("AUTH_SESSION_SECRET", originalAuthSessionSecret);
}

for (const routePath of aiRoutes) {
  const route = read(routePath);
  assert.match(route, /export\s+async\s+function\s+POST\b/, `${routePath} must remain POST-only`);
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    assert.doesNotMatch(
      route,
      new RegExp(`export\\s+async\\s+function\\s+${method}\\b`),
      `${routePath} must not export ${method}`,
    );
  }
  assert.ok(route.includes("requireApiUser(request)"), `${routePath} must authenticate the actor`);
  assert.ok(
    route.includes("readAiProviderPreferenceFromRequest(request)"),
    `${routePath} must read the shared browser preference`,
  );
  assert.ok(
    route.includes("allowExternalProvider: preference.externalProviderEnabled"),
    `${routePath} must pass the shared preference to the provider gate`,
  );
  assert.ok(
    route.indexOf("requireApiUser(request)") <
      route.indexOf("readAiProviderPreferenceFromRequest(request)"),
    `${routePath} must authenticate before reading the shared preference`,
  );
  assert.ok(
    route.indexOf("readAiProviderPreferenceFromRequest(request)") <
      route.indexOf("allowExternalProvider: preference.externalProviderEnabled"),
    `${routePath} must read the shared preference before passing it to the provider gate`,
  );
  assert.equal(
    route.includes("allowExternalProvider: true"),
    false,
    `${routePath} must not bypass the shared provider gate`,
  );
}

const stageAiCompatibilityRoute = read("apps/web/app/api/stage-adjustment-drafts/ai/route.ts");
assert.match(
  stageAiCompatibilityRoute,
  /export \{ POST \} from "@\/app\/api\/simulation\/stage-adjustment-drafts\/ai\/route";/,
);
assert.doesNotMatch(stageAiCompatibilityRoute, /export\s+async\s+function\s+POST\b/);
assert.equal(stageAiCompatibilityRoute.includes("allowExternalProvider: true"), false);

const preferenceRoute = read("apps/web/app/api/ai/preferences/route.ts");
assert.match(preferenceRoute, /export\s+async\s+function\s+GET\b/);
assert.match(preferenceRoute, /export\s+async\s+function\s+PATCH\b/);
assert.ok(preferenceRoute.match(/requireApiUser\(request\)/g)?.length === 2);
assert.ok(preferenceRoute.includes("patchAiProviderPreferenceSchema.safeParse"));
assert.ok(preferenceRoute.includes("response.cookies.set"));
for (const method of ["POST", "PUT", "DELETE"]) {
  assert.doesNotMatch(preferenceRoute, new RegExp(`export\\s+async\\s+function\\s+${method}\\b`));
}

const providerService = read("apps/web/lib/study/ai-service.ts");
const providerResolverStart = providerService.indexOf("export function resolveConfiguredAiProvider");
const providerPrerequisitesStart = providerService.indexOf("export function resolveAiProviderPrerequisites");
const providerResolver = providerService.slice(
  providerResolverStart,
  providerPrerequisitesStart,
);
const providerPrerequisites = providerService.slice(
  providerPrerequisitesStart,
  providerService.indexOf("function logAiProviderConfigIssue", providerPrerequisitesStart),
);
assert.ok(
  providerResolver.indexOf("resolveAiProviderPrerequisites(options)") <
    providerResolver.indexOf("if (options.provider)"),
  "shared provider prerequisites must run before an injected or configured provider is accepted",
);
assert.ok(
  providerPrerequisites.indexOf("if (!options.allowExternalProvider)") <
    providerPrerequisites.indexOf("if (!env.AI_ENABLED)"),
  "the browser preference gate must run before the server AI switch",
);
assert.ok(
  providerPrerequisites.indexOf("if (!env.AI_ENABLED)") <
    providerPrerequisites.indexOf("if (options.provider)"),
  "AI_ENABLED must run before an injected or configured provider is accepted",
);
const draftService = read("apps/web/lib/study/ai-draft-service.ts");
assert.equal(draftService.includes("allowExternalProvider: true"), false);
assert.ok(draftService.includes("allowExternalProvider: options.allowExternalProvider"));
assert.ok(draftService.includes("resolveAiProviderPrerequisites"));
assert.ok(draftService.includes("确认后才可能外呼 provider"));

const settingsPage = read("apps/web/app/(app)/settings/ai/page.tsx");
const settingsClient = read("apps/web/components/ai-settings-client.tsx");
const settingsSections = read("apps/web/components/ai-settings-sections.tsx");
const settingsModals = read("apps/web/components/ai-settings-modals.tsx");
const aiDraftPanel = read("apps/web/components/ai-draft-panel.tsx");
const aiDraftWorkflow = read("apps/web/components/use-ai-draft-workflow.ts");
const aiDraftPanelView = read("apps/web/components/ai-draft-panel-view.tsx");
assert.ok(settingsPage.includes("readAiProviderPreference(await cookies())"));
assert.ok(settingsSections.includes('role="switch"'));
assert.ok(settingsSections.includes("保存 AI 设置"));
assert.ok(settingsModals.includes("<Modal"));
assert.ok(settingsModals.includes("确认开启外部 Provider"));
assert.ok(settingsModals.includes("确认关闭外部 Provider"));
assert.ok(settingsClient.includes("startTransition(saveConfirmedPreference)"));
assert.ok(settingsClient.includes("restoreSaveFocusRef.current = true"));
assert.ok(settingsClient.includes("saveButtonRef.current?.focus()"));
assert.ok(settingsSections.includes("aria-disabled={!props.preferenceChanged || props.preferencePending}"));
assert.ok(
  settingsSections.indexOf("checked={props.runtimeEnabled}") < settingsSections.indexOf("AI_ENABLED") &&
    settingsSections.indexOf("AI_ENABLED") < settingsSections.indexOf("隐私边界：") &&
    settingsSections.indexOf("隐私边界：") < settingsSections.indexOf("保存 AI 设置"),
  "settings order must remain switch -> provider/binding status -> privacy -> save",
);
assert.doesNotMatch(settingsClient, /startTransition\(\(\) => void saveConfirmedPreference\(\)\)/);
assert.match(
  settingsClient,
  /const failure = classifyApiFailure\(result\);\s+closeConfirmModal\(\);\s+setError\([\s\S]+?if \(failure\.kind === "unauthorized"\) setReauthRequired\(true\);/,
);
assert.equal(settingsClient.includes("redirectToLoginWithCurrentLocation"), false);
assert.ok(settingsSections.includes("在新标签页重新登录"));
assert.ok(settingsSections.includes('href="/login?returnTo=%2Fsettings%2Fai"'));
assert.ok(settingsSections.includes('target="_blank"'));
assert.match(
  settingsClient,
  /if \(!isAiProviderPreference\(payload\?\.preference\)\) \{\s+closeConfirmModal\(\);\s+setError\(/,
);
assert.match(
  settingsClient,
  /catch \{\s+closeConfirmModal\(\);\s+setError\("网络不可用/,
);
assert.equal(settingsClient.includes("AI_API_KEY"), false);
assert.equal(settingsClient.includes("AI_PAYLOAD_BINDING_SECRET"), false);
assert.ok(aiDraftWorkflow.includes('typeof response.body.note !== "string"'));
assert.ok(aiDraftWorkflow.includes("previewNote: previewBody.note"));
assert.ok(aiDraftPanelView.includes('<p role="status"'));
assert.ok(aiDraftPanelView.includes('title="本次生成输入预览"'));
assert.equal(aiDraftPanel.includes('title="将发送以下内容"'), false);
assert.equal(aiDraftPanelView.includes('title="将发送以下内容"'), false);

console.log(
  `v1.1 AI provider preference selftest passed (${aiRoutes.length} gated AI POST routes + compatibility re-export).`,
);

function read(file: string): string {
  return readFileSync(resolve(root, file), "utf8");
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
