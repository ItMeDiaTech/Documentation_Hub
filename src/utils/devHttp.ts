import type { DevHttpSettings, DevKeyValue } from "@/types/settings";

/**
 * Pure helpers that turn the persisted Dev Env HTTP form into a concrete
 * request. Kept separate from React/Electron so the request-shaping logic
 * (URL joining, auth header derivation) is unit-testable in isolation.
 */

export interface BuiltDevRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Base64-encode a UTF-8 string in both the renderer (btoa) and Node (Buffer). */
function toBase64(input: string): string {
  if (typeof TextEncoder !== "undefined" && typeof btoa === "function") {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }
  return Buffer.from(input, "utf-8").toString("base64");
}

/**
 * Join base URL + path, then append enabled query params. An absolute http(s)
 * `path` overrides the base entirely (handy for one-off requests to another host).
 */
export function buildDevRequestUrl(
  baseUrl: string,
  path: string,
  params: DevKeyValue[]
): string {
  const base = (baseUrl || "").trim().replace(/\/+$/, "");
  const target = (path || "").trim();

  let url: string;
  if (/^https?:\/\//i.test(target)) {
    url = target;
  } else if (!base) {
    url = target;
  } else {
    url = target ? `${base}/${target.replace(/^\/+/, "")}` : base;
  }

  const enabled = (params || []).filter((kv) => kv.enabled && kv.key.trim());
  if (enabled.length) {
    const query = enabled
      .map((kv) => `${encodeURIComponent(kv.key.trim())}=${encodeURIComponent(kv.value)}`)
      .join("&");
    url += (url.includes("?") ? "&" : "?") + query;
  }
  return url;
}

/** Build request headers from the explicit rows plus the chosen auth scheme. */
export function buildDevHeaders(http: DevHttpSettings): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of http.headers || []) {
    if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
  }

  const secret = http.authSecret || "";
  switch (http.authType) {
    case "basic":
      if (http.authUsername || secret) {
        headers["Authorization"] = "Basic " + toBase64(`${http.authUsername}:${secret}`);
      }
      break;
    case "bearer":
      if (secret) headers["Authorization"] = `Bearer ${secret}`;
      break;
    case "token":
      // Nuxeo token-based authentication header
      if (secret) headers["X-Authentication-Token"] = secret;
      break;
    case "none":
    default:
      break;
  }
  return headers;
}

/** Assemble the full request the Dev Env should send. */
export function buildDevRequest(http: DevHttpSettings): BuiltDevRequest {
  const method = (http.method || "GET").toUpperCase();
  const url = buildDevRequestUrl(http.baseUrl, http.path, http.params);
  const headers = buildDevHeaders(http);
  const hasBody = method !== "GET" && method !== "HEAD" && (http.body || "").trim().length > 0;
  return { method, url, headers, body: hasBody ? http.body : undefined };
}

/** Create a fresh, stable-id key/value row for the header/param editors. */
export function newKeyValueRow(): DevKeyValue {
  return { id: crypto.randomUUID(), key: "", value: "", enabled: true };
}
