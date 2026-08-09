export interface ActivityTimerSession {
  id: string;
  status: string;
}

/**
 * CLOSING is an internal server state. The source page still queries it to
 * submit the result, but the client must render the closeout form instead of a
 * second timer after a refresh.
 */
export function activeTimerSessionId(sessions: readonly ActivityTimerSession[]): string | null {
  return sessions.find((session) => session.status === "RUNNING" || session.status === "PAUSED")?.id ?? null;
}
