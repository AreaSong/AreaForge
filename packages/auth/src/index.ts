import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const passwordKeyLength = 64;
const scryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
} as const;

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
  mintLearningTreePreviewToken,
  sha256Hex,
  verifyLearningTreePreviewToken,
} from "./learning-tree-crypto";

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
