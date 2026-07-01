import type { DevHttpSettings, DevKeyValue } from "@/types/settings";
import { buildDevHeaders, buildDevRequest, buildDevRequestUrl } from "@/utils/devHttp";

function kv(key: string, value: string, enabled = true): DevKeyValue {
  return { id: `${key}-${value}`, key, value, enabled };
}

function baseHttp(overrides: Partial<DevHttpSettings> = {}): DevHttpSettings {
  return {
    baseUrl: "https://host/nuxeo",
    path: "/api/v1/query",
    method: "GET",
    authType: "none",
    authUsername: "",
    authSecret: "",
    params: [],
    headers: [],
    body: "",
    timeoutMs: 45000,
    ...overrides,
  };
}

describe("buildDevRequestUrl", () => {
  it("joins base and path, trimming duplicate slashes", () => {
    expect(buildDevRequestUrl("https://host/nuxeo/", "/api/v1/query", [])).toBe(
      "https://host/nuxeo/api/v1/query"
    );
  });

  it("uses the base alone when the path is empty", () => {
    expect(buildDevRequestUrl("https://host/nuxeo", "", [])).toBe("https://host/nuxeo");
  });

  it("lets an absolute path override the base", () => {
    expect(buildDevRequestUrl("https://host/nuxeo", "https://other/api", [])).toBe(
      "https://other/api"
    );
  });

  it("appends only enabled params, URL-encoded", () => {
    const params = [kv("query", "SELECT * FROM Document"), kv("skip", "10", false)];
    expect(buildDevRequestUrl("https://host/nuxeo", "/api/v1/query", params)).toBe(
      "https://host/nuxeo/api/v1/query?query=SELECT%20*%20FROM%20Document"
    );
  });

  it("uses & when the path already has a query string", () => {
    const url = buildDevRequestUrl("https://host", "/x?a=1", [kv("b", "2")]);
    expect(url).toBe("https://host/x?a=1&b=2");
  });
});

describe("buildDevHeaders", () => {
  it("includes enabled explicit headers only", () => {
    const headers = buildDevHeaders(
      baseHttp({ headers: [kv("Accept", "application/json"), kv("X-Off", "no", false)] })
    );
    expect(headers).toEqual({ Accept: "application/json" });
  });

  it("builds a Basic auth header", () => {
    const headers = buildDevHeaders(
      baseHttp({ authType: "basic", authUsername: "user", authSecret: "pass" })
    );
    expect(headers["Authorization"]).toBe(`Basic ${btoa("user:pass")}`);
  });

  it("builds a Bearer auth header", () => {
    const headers = buildDevHeaders(baseHttp({ authType: "bearer", authSecret: "tok" }));
    expect(headers["Authorization"]).toBe("Bearer tok");
  });

  it("builds a Nuxeo token header", () => {
    const headers = buildDevHeaders(baseHttp({ authType: "token", authSecret: "abc" }));
    expect(headers["X-Authentication-Token"]).toBe("abc");
  });

  it("adds no auth header when authType is none", () => {
    const headers = buildDevHeaders(baseHttp({ authType: "none", authSecret: "ignored" }));
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["X-Authentication-Token"]).toBeUndefined();
  });
});

describe("buildDevRequest", () => {
  it("omits the body for GET", () => {
    const req = buildDevRequest(baseHttp({ method: "GET", body: '{"a":1}' }));
    expect(req.body).toBeUndefined();
    expect(req.method).toBe("GET");
  });

  it("includes the body for POST", () => {
    const req = buildDevRequest(baseHttp({ method: "POST", body: '{"a":1}' }));
    expect(req.body).toBe('{"a":1}');
    expect(req.method).toBe("POST");
  });

  it("omits an empty/whitespace body for POST", () => {
    const req = buildDevRequest(baseHttp({ method: "POST", body: "   " }));
    expect(req.body).toBeUndefined();
  });
});
