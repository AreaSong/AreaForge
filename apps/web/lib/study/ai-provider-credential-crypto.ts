import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAuthEnv } from "@/lib/auth/env";

const cipherAlgorithm = "aes-256-gcm";
const cipherVersion = "v1";
const aad = Buffer.from("areaforge:ai-provider-credential:v1", "utf8");
const ivBytes = 12;
const authTagBytes = 16;

export class AiProviderCredentialCryptoError extends Error {
  constructor(public readonly reason: "missing_key" | "invalid_ciphertext" | "decrypt_failed") {
    super(reason);
  }
}

export function encryptAiProviderApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (!normalized) throw new AiProviderCredentialCryptoError("invalid_ciphertext");

  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv(cipherAlgorithm, getEncryptionKey(), iv, { authTagLength: authTagBytes });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    cipherVersion,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptAiProviderApiKey(serialized: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, ...extra] = serialized.split(":");
  if (
    version !== cipherVersion
    || !encodedIv
    || !encodedAuthTag
    || !encodedCiphertext
    || extra.length > 0
  ) {
    throw new AiProviderCredentialCryptoError("invalid_ciphertext");
  }

  try {
    const iv = Buffer.from(encodedIv, "base64url");
    const authTag = Buffer.from(encodedAuthTag, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    if (iv.length !== ivBytes || authTag.length !== authTagBytes || ciphertext.length === 0) {
      throw new AiProviderCredentialCryptoError("invalid_ciphertext");
    }

    const decipher = createDecipheriv(cipherAlgorithm, getEncryptionKey(), iv, { authTagLength: authTagBytes });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof AiProviderCredentialCryptoError) throw error;
    throw new AiProviderCredentialCryptoError("decrypt_failed");
  }
}

export function fingerprintAiProviderApiKey(apiKey: string): string {
  return `sha256:${createHash("sha256").update(apiKey.trim(), "utf8").digest("hex")}`;
}

export function isAiProviderCredentialEncryptionConfigured(): boolean {
  const value = getAuthEnv().AI_CREDENTIALS_ENCRYPTION_KEY;
  return typeof value === "string" && value.length >= 32;
}

function getEncryptionKey(): Buffer {
  const value = getAuthEnv().AI_CREDENTIALS_ENCRYPTION_KEY;
  if (!value || value.length < 32) {
    throw new AiProviderCredentialCryptoError("missing_key");
  }

  return createHash("sha256").update(value, "utf8").digest();
}
