"use client";

const DEVICE_ID_KEY = "areaforge.client-device-id.v1";
let volatileDeviceId: string | null = null;

export interface ClientDeviceIdentity {
  id: string;
  label: string;
}

/**
 * Keep device identity deliberately coarse: it is only used to explain which
 * client owns the shared timer, not to fingerprint the browser.
 */
export function getClientDeviceIdentity(): ClientDeviceIdentity {
  if (typeof window === "undefined") return { id: "server", label: "当前设备" };

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

  return { id, label: detectDeviceLabel() };
}

export function getClientDeviceHeaders(): Record<string, string> {
  const identity = getClientDeviceIdentity();
  return {
    "x-areaforge-device-id": identity.id,
    "x-areaforge-device-label": identity.label,
  };
}

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isSafeDeviceId(value: string): boolean {
  return value.length >= 8 && value.length <= 100 && /^[A-Za-z0-9:_-]+$/.test(value);
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
