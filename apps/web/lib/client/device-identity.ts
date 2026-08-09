"use client";

const DEVICE_ID_KEY = "areaforge.client-device-id.v1";
const DEVICE_LABEL_KEY = "areaforge.client-device-label.v1";
const DEVICE_IDENTITY_CHANGED_EVENT = "areaforge:device-identity-changed";
let volatileDeviceId: string | null = null;
let volatileDeviceLabel: string | null = null;

export interface ClientDeviceIdentity {
  id: string;
  label: string;
  detectedLabel: string;
}

/**
 * Keep device identity deliberately coarse: it is only used to explain which
 * client owns the shared timer, not to fingerprint the browser.
 */
export function getClientDeviceIdentity(): ClientDeviceIdentity {
  if (typeof window === "undefined") return { id: "server", label: "当前设备", detectedLabel: "当前设备" };

  let id: string | null = null;
  try {
    id = window.localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // A private browsing context may reject storage; use an in-memory identity.
  }
  if (!id || !isSafeDeviceId(id)) {
    id = volatileDeviceId ?? createDeviceId();
    volatileDeviceId = id;
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // A private browsing context may reject storage. The in-memory ID is
      // still sufficient for the current page lifecycle.
    }
  } else {
    // 后续存储不可用时，仍保留已持久化的设备身份。
    volatileDeviceId = id;
  }

  const detectedLabel = detectDeviceLabel();
  return { id, label: readDeviceLabel() ?? detectedLabel, detectedLabel };
}

export function getClientDeviceHeaders(): Record<string, string> {
  const identity = getClientDeviceIdentity();
  return {
    "x-areaforge-device-id": identity.id,
    "x-areaforge-device-label": identity.label,
  };
}

export function setClientDeviceLabel(value: string): ClientDeviceIdentity {
  const label = normalizeClientDeviceLabel(value);
  volatileDeviceLabel = label;
  try {
    if (label) window.localStorage.setItem(DEVICE_LABEL_KEY, label);
    else window.localStorage.removeItem(DEVICE_LABEL_KEY);
  } catch {
    // Keep the user-selected name for the current page lifecycle.
  }
  window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
  return getClientDeviceIdentity();
}

export function subscribeClientDeviceIdentity(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEVICE_ID_KEY || event.key === DEVICE_LABEL_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DEVICE_IDENTITY_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DEVICE_IDENTITY_CHANGED_EVENT, listener);
  };
}

export function normalizeClientDeviceLabel(value: string): string | null {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? [...normalized].slice(0, 40).join("") : null;
}

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isSafeDeviceId(value: string): boolean {
  return value.length >= 8 && value.length <= 100 && /^[A-Za-z0-9:_-]+$/.test(value);
}

function readDeviceLabel(): string | null {
  try {
    const stored = normalizeClientDeviceLabel(window.localStorage.getItem(DEVICE_LABEL_KEY) ?? "");
    if (stored) volatileDeviceLabel = stored;
    return stored ?? volatileDeviceLabel;
  } catch {
    return volatileDeviceLabel;
  }
}

function detectDeviceLabel(): string {
  const platform = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  if (/iphone|ipad|ipod/.test(userAgent) || /iphone|ipad|ipod/.test(platform)) return "iPhone / iPad";
  if (/android/.test(userAgent)) return "Android 设备";
  if (/mac/.test(platform) || /macintosh/.test(userAgent)) return "Mac";
  if (/win/.test(platform) || /windows/.test(userAgent)) return "Windows";
  if (/linux/.test(platform) || /linux/.test(userAgent)) return "Linux";
  return "当前设备";
}
