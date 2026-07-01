import { createMcpServer, migrateMcpServers } from "@/utils/mcpServers";

describe("createMcpServer", () => {
  it("creates a blank entry with an id and remote defaults", () => {
    const s = createMcpServer();
    expect(s.id).toBeTruthy();
    expect(s.enabled).toBe(true);
    expect(s.transport).toBe("sse");
    expect(s.env).toEqual([]);
    expect(s.headers).toEqual([]);
    expect(s.name).toBe("");
  });

  it("gives each entry a distinct id", () => {
    expect(createMcpServer().id).not.toBe(createMcpServer().id);
  });
});

describe("migrateMcpServers", () => {
  it("returns [] for undefined or empty devEnv", () => {
    expect(migrateMcpServers(undefined)).toEqual([]);
    expect(migrateMcpServers({})).toEqual([]);
    expect(migrateMcpServers({ mcpServers: [] })).toEqual([]);
  });

  it("keeps an existing array and preserves ids", () => {
    const result = migrateMcpServers({
      mcpServers: [{ id: "keep-1", name: "a", transport: "http" }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("keep-1");
    expect(result[0].name).toBe("a");
    expect(result[0].transport).toBe("http");
  });

  it("backfills a missing id and normalizes fields", () => {
    const result = migrateMcpServers({ mcpServers: [{ name: "no-id" }] });
    expect(result[0].id).toBeTruthy();
    expect(result[0].env).toEqual([]);
    expect(result[0].headers).toEqual([]);
    expect(result[0].transport).toBe("sse"); // invalid/missing -> default
  });

  it("migrates a non-empty legacy mcpTunnel into one entry", () => {
    const result = migrateMcpServers({
      mcpTunnel: { name: "old", url: "https://x/mcp", transport: "http", authToken: "t", notes: "n" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("old");
    expect(result[0].url).toBe("https://x/mcp");
    expect(result[0].transport).toBe("http");
    expect(result[0].authToken).toBe("t");
    expect(result[0].id).toBeTruthy();
  });

  it("ignores an empty legacy mcpTunnel", () => {
    expect(
      migrateMcpServers({ mcpTunnel: { name: "", url: "", authToken: "", notes: "" } })
    ).toEqual([]);
  });

  it("prefers the array over a legacy tunnel when both exist", () => {
    const result = migrateMcpServers({
      mcpServers: [{ id: "arr", name: "fromArray" }],
      mcpTunnel: { name: "legacy", url: "https://y" },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("fromArray");
  });
});
