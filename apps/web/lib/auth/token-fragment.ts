const maxActionTokenLength = 256;

export function consumeActionTokenFragment(storageKey?: string): string {
  if (typeof window === "undefined") return "";
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const candidate = fragment.get("token") ?? "";
  const token = candidate.length >= 32 && candidate.length <= maxActionTokenLength
    ? candidate
    : storageKey ? window.sessionStorage.getItem(storageKey) ?? "" : "";
  if (candidate) {
    if (storageKey && token) window.sessionStorage.setItem(storageKey, token);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return token;
}

export function clearStoredActionToken(storageKey: string): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(storageKey);
}
