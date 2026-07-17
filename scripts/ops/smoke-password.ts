import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

export function readRestrictedSmokePassword(passwordFile = process.env.AREAFORGE_SMOKE_PASSWORD_FILE): string {
  const fileDescriptor = openRestrictedSmokePasswordFile(passwordFile);
  try {
    const password = readFileSync(fileDescriptor, "utf8").trim();
    if (!password) throw new Error("AREAFORGE_SMOKE_PASSWORD_FILE is empty");
    return password;
  } finally {
    closeSync(fileDescriptor);
  }
}

export function validateRestrictedSmokePasswordFile(passwordFile = process.env.AREAFORGE_SMOKE_PASSWORD_FILE): void {
  const fileDescriptor = openRestrictedSmokePasswordFile(passwordFile);
  closeSync(fileDescriptor);
}

function openRestrictedSmokePasswordFile(passwordFile: string | undefined): number {
  if (!passwordFile) throw new Error("AREAFORGE_SMOKE_PASSWORD_FILE is required");
  if (!path.isAbsolute(passwordFile)) throw new Error("AREAFORGE_SMOKE_PASSWORD_FILE must be absolute");
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error("AREAFORGE_SMOKE_PASSWORD_FILE cannot be opened with no-follow protection on this platform");
  }

  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(passwordFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("cannot read AREAFORGE_SMOKE_PASSWORD_FILE");
  }

  try {
    const metadata = fstatSync(fileDescriptor);
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error("AREAFORGE_SMOKE_PASSWORD_FILE must be a single regular file, not a link");
    }
    if ((metadata.mode & 0o077) !== 0 || (metadata.mode & 0o400) === 0) {
      throw new Error("AREAFORGE_SMOKE_PASSWORD_FILE must be owner-readable and group/world-inaccessible");
    }
    return fileDescriptor;
  } catch (error) {
    closeSync(fileDescriptor);
    if (error instanceof Error && /AREAFORGE_SMOKE_PASSWORD_FILE/.test(error.message)) throw error;
    throw new Error("cannot read AREAFORGE_SMOKE_PASSWORD_FILE");
  }
}
