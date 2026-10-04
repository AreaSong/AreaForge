export type CanonicalHttpsUrlResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal"];

export function canonicalizeHttpsUrl(raw: string): CanonicalHttpsUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (!/^https:\/\//i.test(trimmed)) return { ok: false, reason: "scheme_not_https" };

  const withoutScheme = trimmed.slice("https://".length);
  const authorityEnd = withoutScheme.search(/[/?#]/);
  const authority = authorityEnd === -1 ? withoutScheme : withoutScheme.slice(0, authorityEnd);
  const rest = authorityEnd === -1 ? "" : withoutScheme.slice(authorityEnd);

  if (authority.includes("@")) return { ok: false, reason: "userinfo_forbidden" };
  if (rest.includes("#")) return { ok: false, reason: "fragment_forbidden" };

  let host = authority;
  let port = "";
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close === -1) return { ok: false, reason: "parse_failed" };
    host = authority.slice(0, close + 1);
    const after = authority.slice(close + 1);
    if (after.startsWith(":")) port = after.slice(1);
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon !== -1 && /^\d+$/.test(authority.slice(colon + 1))) {
      host = authority.slice(0, colon);
      port = authority.slice(colon + 1);
    }
  }

  host = host.toLowerCase();
  if (!host) return { ok: false, reason: "host_missing" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "localhost_forbidden" };
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: "local_suffix_forbidden" };
  }
  if (isIpLiteral(host)) return { ok: false, reason: "ip_literal_forbidden" };
  if (port && port !== "443") return { ok: false, reason: "non_canonical_port" };

  const pathAndQuery = rest.split("#")[0] ?? "";
  return {
    ok: true,
    url: `https://${host}${pathAndQuery}`,
    host: host.startsWith("[") ? host.slice(1, -1) : host,
  };
}

function isIpLiteral(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}
