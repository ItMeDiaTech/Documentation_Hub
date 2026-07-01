import type { DevMcpServer, DevMcpTransport } from "@/types/settings";

/**
 * Helpers for the Dev Env MCP server list: creating blank entries and migrating
 * persisted settings (backfilling ids, and converting the legacy single
 * `mcpTunnel` object into a one-item list). Kept pure so the migration is
 * unit-testable without React/Electron.
 */

/** Stable id, using crypto.randomUUID when available with a safe fallback. */
function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mcp-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const VALID_TRANSPORTS: DevMcpTransport[] = ["stdio", "sse", "http"];

function normalizeTransport(value: unknown): DevMcpTransport {
  return VALID_TRANSPORTS.includes(value as DevMcpTransport)
    ? (value as DevMcpTransport)
    : "sse";
}

/** A fresh, empty MCP server entry (defaults to the remote SSE transport). */
export function createMcpServer(): DevMcpServer {
  return {
    id: genId(),
    name: "",
    enabled: true,
    transport: "sse",
    command: "",
    args: "",
    env: [],
    cwd: "",
    url: "",
    headers: [],
    authToken: "",
    notes: "",
  };
}

/** Coerce one persisted (possibly partial/legacy) entry into a full DevMcpServer. */
function normalizeServer(raw: Partial<DevMcpServer>): DevMcpServer {
  const base = createMcpServer();
  return {
    ...base,
    ...raw,
    id: raw.id ?? base.id,
    transport: normalizeTransport(raw.transport),
    env: Array.isArray(raw.env) ? raw.env : [],
    headers: Array.isArray(raw.headers) ? raw.headers : [],
  };
}

/** Legacy single-tunnel shape stored before the list existed. */
interface LegacyMcpTunnel {
  name?: string;
  url?: string;
  transport?: string;
  authToken?: string;
  notes?: string;
}

/**
 * Build the MCP server list from persisted `devEnv`. Prefers an existing
 * `mcpServers` array (backfilling ids); otherwise migrates a non-empty legacy
 * `mcpTunnel` object into a single entry; otherwise returns an empty list.
 */
export function migrateMcpServers(
  devEnv: { mcpServers?: Partial<DevMcpServer>[]; mcpTunnel?: LegacyMcpTunnel } | undefined
): DevMcpServer[] {
  const list = devEnv?.mcpServers;
  if (Array.isArray(list) && list.length > 0) {
    return list.map(normalizeServer);
  }

  const legacy = devEnv?.mcpTunnel;
  if (legacy && (legacy.name || legacy.url || legacy.authToken || legacy.notes)) {
    return [
      normalizeServer({
        name: legacy.name,
        url: legacy.url,
        transport: normalizeTransport(legacy.transport),
        authToken: legacy.authToken,
        notes: legacy.notes,
      }),
    ];
  }

  return [];
}
