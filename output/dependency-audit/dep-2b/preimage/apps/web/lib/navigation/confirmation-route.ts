export interface ConfirmationWindowRouteRequest {
  filter: "pending" | "history";
  confirmationId?: string;
}

export function getConfirmationWindowRouteRequest(pathname: string): ConfirmationWindowRouteRequest | null {
  if (pathname === "/confirmations") return { filter: "pending" };
  if (pathname === "/confirmations/history") return { filter: "history" };
  if (!pathname.startsWith("/confirmations/")) return null;

  const encodedId = pathname.slice("/confirmations/".length);
  if (!encodedId || encodedId.includes("/")) return null;
  try {
    const confirmationId = decodeURIComponent(encodedId);
    if (!confirmationId || confirmationId.includes("/")) return null;
    return { filter: "pending", confirmationId };
  } catch {
    return null;
  }
}

export function isConfirmationWindowPath(pathname: string): boolean {
  return getConfirmationWindowRouteRequest(pathname) !== null;
}
