import { apiErrorResponse } from "../../apps/web/lib/api/responses";

async function main(): Promise<void> {
  const originalError = console.error;
  const logs: unknown[] = [];
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    const response = apiErrorResponse(new Error("DATABASE_URL=postgresql://user:pass@example.test/db token=secret private review body"));
    const body = await response.json() as Record<string, unknown>;
    if (response.status !== 500 || body.error !== "INTERNAL_ERROR" || typeof body.errorId !== "string") {
      throw new Error("internal error response contract failed");
    }
    const serializedLogs = JSON.stringify(logs);
    if (serializedLogs.includes("DATABASE_URL") || serializedLogs.includes("postgresql://") || serializedLogs.includes("secret") || serializedLogs.includes("private review body")) {
      throw new Error("raw internal error text leaked into logs");
    }
    if (!serializedLogs.includes(body.errorId)) throw new Error("redacted log must include the response errorId");
  } finally {
    console.error = originalError;
  }
  console.log("API error redaction selftest passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
