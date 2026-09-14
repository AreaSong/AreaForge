export function createDeletionRequestIdentity() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { idempotencyKey: crypto.randomUUID(), receiptToken: [...bytes].map(value => value.toString(16).padStart(2, "0")).join("") };
}
