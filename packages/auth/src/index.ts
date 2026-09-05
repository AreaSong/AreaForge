import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const passwordKeyLength = 64;
const scryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
} as const;

// 固定格式、非账户专属的 dummy hash，仅用于让未知账户登录走同等级 scrypt 成本。
// 它不对应任何可登录账户，也不是密码或生产 secret。
const dummyPasswordHash = "scrypt$16384$8$1$YXJlYWZvcmdlLWR1bW15LXNsdA$G9rRjKF04hIdua2FBWwy7FNosYIqdL3ZuZvEnc6ss1N64xNtvFoapCgPSDWIGn0TNp7z1Mii9dhP2n-lXeZwZw";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, passwordKeyLength, scryptOptions);
  return [
    "scrypt",
    scryptOptions.N,
    scryptOptions.r,
    scryptOptions.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [scheme, n, r, p, saltValue, keyValue] = passwordHash.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltValue || !keyValue) return false;

  const salt = Buffer.from(saltValue, "base64url");
  const expectedKey = Buffer.from(keyValue, "base64url");
  const actualKey = await scryptAsync(password, salt, expectedKey.length, {
    N: Number.parseInt(n, 10),
    r: Number.parseInt(r, 10),
    p: Number.parseInt(p, 10),
  });

  return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey);
}

export function getDummyPasswordHash(): string {
  return dummyPasswordHash;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export {
  createPlanBatchRef,
  mintLearningTreeExportToken,
  mintLearningTreePreviewToken,
  sha256Hex,
  verifyLearningTreeExportToken,
  verifyLearningTreePreviewToken,
} from "./learning-tree-crypto";

export {
  AI_DRAFT_RESULT_PROOF_MAX_LENGTH,
  AI_DRAFT_RESULT_PROOF_PURPOSE,
  AI_DRAFT_RESULT_PROOF_TTL_MS,
  AI_DRAFT_RESULT_PROOF_VERSION,
  hmacAiPayload,
  isAiDraftResultProofLengthAllowed,
  isValidAiPayloadBindingSecret,
  mintAiDraftPreviewToken,
  mintAiDraftResultProof,
  verifyAiDraftPreviewToken,
  verifyAiDraftResultProof,
  type AiDraftResultProofClaims,
  type AiDraftResultProofExpected,
  type AiDraftResultProofInput,
  type AiDraftResultProofVerification,
} from "./ai-payload-binding";

export {
  authActionTokenBytes,
  authActionTokenHashMatches,
  createAuthActionToken,
  createWorkspaceInvitationToken,
  deriveDeviceLabel,
  hashAuthActionToken,
  hashWorkspaceInvitationToken,
  isAuthActionTokenUsable,
  isPasswordPolicySatisfied,
  isReauthenticationFresh,
  isSessionUsable,
  isWorkspaceInvitationUsable,
  reauthenticationMaxAgeMs,
  type AuthActionPurpose,
  type AuthenticatedAccountStatus,
} from "./auth-security";

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}
