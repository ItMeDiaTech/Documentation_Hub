import { normalizeExternalUrl, isOpenableExternalUrl } from "../urlHelpers";

describe("normalizeExternalUrl", () => {
  it("returns empty/whitespace-only input as an empty string", () => {
    expect(normalizeExternalUrl("")).toBe("");
    expect(normalizeExternalUrl("   ")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeExternalUrl("  www.example.com  ")).toBe("https://www.example.com");
  });

  it("prepends https:// to a bare domain", () => {
    expect(normalizeExternalUrl("www.example.com")).toBe("https://www.example.com");
    expect(normalizeExternalUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("prepends mailto: to a bare email address", () => {
    expect(normalizeExternalUrl("user@example.com")).toBe("mailto:user@example.com");
  });

  it("treats an @-containing string that is not a bare email as a domain", () => {
    // Contains a space → not a bare email → https:// fallback.
    expect(normalizeExternalUrl("a b@c.com")).toBe("https://a b@c.com");
  });

  it("leaves already-schemed input untouched", () => {
    expect(normalizeExternalUrl("https://example.com")).toBe("https://example.com");
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeExternalUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(normalizeExternalUrl("ftp://example.com")).toBe("ftp://example.com");
  });

  it("does not add a scheme to a potentially dangerous schemed input", () => {
    // Normalizer only ADDS a missing scheme — it never rewrites one. The
    // openable check (below) is what rejects these.
    expect(normalizeExternalUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});

describe("isOpenableExternalUrl", () => {
  it("accepts https and mailto URLs", () => {
    expect(isOpenableExternalUrl("https://example.com")).toBe(true);
    expect(isOpenableExternalUrl("mailto:a@b.com")).toBe(true);
  });

  it("rejects http and other non-allowed schemes", () => {
    expect(isOpenableExternalUrl("http://example.com")).toBe(false);
    expect(isOpenableExternalUrl("ftp://example.com")).toBe(false);
    expect(isOpenableExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects unparseable / empty input", () => {
    expect(isOpenableExternalUrl("")).toBe(false);
    expect(isOpenableExternalUrl("not a url")).toBe(false);
    expect(isOpenableExternalUrl("www.example.com")).toBe(false); // no scheme → unparseable
  });

  it("accepts the output of normalizeExternalUrl for typical user input", () => {
    expect(isOpenableExternalUrl(normalizeExternalUrl("www.example.com"))).toBe(true);
    expect(isOpenableExternalUrl(normalizeExternalUrl("user@example.com"))).toBe(true);
  });

  it("documents the intentional http asymmetry", () => {
    // normalizeExternalUrl passes `http://` through unchanged, but the
    // Electron open-external handler (and this check) allow https only.
    const normalized = normalizeExternalUrl("http://example.com");
    expect(normalized).toBe("http://example.com");
    expect(isOpenableExternalUrl(normalized)).toBe(false);
  });
});
