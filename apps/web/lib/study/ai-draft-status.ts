import { isValidAiPayloadBindingSecret } from "@areaforge/auth";
import { getAuthEnv } from "@/lib/auth/env";

/** Server-only status for settings UI — never expose the secret value. */
export function getAiDraftBindingStatus(): {
  aiEnabled: boolean;
  modelConfigured: boolean;
  bindingSecretConfigured: boolean;
} {
  const env = getAuthEnv();
  return {
    aiEnabled: env.AI_ENABLED,
    modelConfigured: Boolean(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL),
    bindingSecretConfigured: isValidAiPayloadBindingSecret(env.AI_PAYLOAD_BINDING_SECRET),
  };
}
