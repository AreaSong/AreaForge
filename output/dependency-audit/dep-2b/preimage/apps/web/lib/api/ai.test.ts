import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeAiDraft,
  generateAiDraft,
  previewAiDraft,
  updateAiPreference,
  updateAiProvider,
  updateAiRuntime,
} from "./ai";

test("AI adapters own endpoint paths, methods, and typed JSON transport", async () => {
  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(new Request(new URL(String(input), "http://local.test"), init));
    return Response.json({});
  };
  try {
    await updateAiRuntime({ enabled: true, expectedRevision: 2 });
    await updateAiPreference({ externalProviderEnabled: true });
    await updateAiProvider({
      baseUrl: "https://provider.example/v1",
      model: "model-1",
      apiKey: "secret",
      expectedRevision: 3,
    });
    await previewAiDraft("learning-tree", {
      phase: "preview",
      selectedText: "极限",
      scope: "branch",
      checkedProjection: { subjectLabel: "数学" },
    });
    await generateAiDraft("motivation", {
      phase: "generate",
      previewToken: "token-1",
      selectedText: "继续推进",
      tone: "BRIEF",
    });
    await acknowledgeAiDraft("plan", { phase: "ack", resultProof: "proof-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ["PATCH", "http://local.test/api/ai/runtime"],
    ["PATCH", "http://local.test/api/ai/preferences"],
    ["PATCH", "http://local.test/api/ai/provider"],
    ["POST", "http://local.test/api/ai/drafts/learning-tree"],
    ["POST", "http://local.test/api/ai/drafts/motivation"],
    ["POST", "http://local.test/api/ai/drafts/plan"],
  ]);
  assert.deepEqual(await Promise.all(requests.map((request) => request.json())), [
    { enabled: true, expectedRevision: 2 },
    { externalProviderEnabled: true },
    { baseUrl: "https://provider.example/v1", model: "model-1", apiKey: "secret", expectedRevision: 3 },
    { phase: "preview", selectedText: "极限", scope: "branch", checkedProjection: { subjectLabel: "数学" } },
    { phase: "generate", previewToken: "token-1", selectedText: "继续推进", tone: "BRIEF" },
    { phase: "ack", resultProof: "proof-1" },
  ]);
});
