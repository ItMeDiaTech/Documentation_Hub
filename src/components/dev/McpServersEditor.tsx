import { ArrowDown, ArrowUp, Info, Plus, Server, Trash2 } from "lucide-react";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import type { DevMcpServer, DevMcpTransport } from "@/types/settings";
import { createMcpServer } from "@/utils/mcpServers";
import { cn } from "@/utils/cn";
import { KeyValueEditor } from "./KeyValueEditor";
import { SecretInput } from "./SecretInput";

const fieldClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

const TRANSPORTS: DevMcpTransport[] = ["stdio", "sse", "http"];

/**
 * Editable list of MCP servers. Mirrors the Document Managers list (add / remove
 * / reorder), but each entry is a full MCP client config whose fields depend on
 * the chosen transport. Stores details only — connecting is a later step.
 */
export function McpServersEditor() {
  const { settings, updateDevEnvSettings } = useUserSettings();
  const servers = settings.devEnv.mcpServers;

  const setServers = (next: DevMcpServer[]) => updateDevEnvSettings({ mcpServers: next });

  const updateServer = (id: string, patch: Partial<DevMcpServer>) =>
    setServers(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addServer = () => setServers([...servers, createMcpServer()]);

  const removeServer = (id: string) => setServers(servers.filter((s) => s.id !== id));

  const moveServer = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= servers.length) return;
    const next = [...servers];
    [next[index], next[target]] = [next[target], next[index]];
    setServers(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3">
        <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Add one entry per MCP server. This stores the details only — connecting to them is not
          wired up yet, that&apos;s a later step.
        </p>
      </div>

      {servers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No MCP servers yet. Use the button below to add your first one.
        </p>
      )}

      {servers.map((server, index) => {
        const isRemote = server.transport === "sse" || server.transport === "http";
        return (
          <div key={server.id} className="rounded-lg border border-border bg-muted/10 p-4 space-y-3">
            {/* Header: name + enable + reorder + remove */}
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={server.name}
                onChange={(e) => updateServer(server.id, { name: e.target.value })}
                placeholder="work-mcp"
                spellCheck={false}
                aria-label="MCP server name"
                className={cn(fieldClass, "flex-1")}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <input
                  type="checkbox"
                  checked={server.enabled}
                  onChange={(e) => updateServer(server.id, { enabled: e.target.checked })}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                Enabled
              </label>
              <button
                type="button"
                onClick={() => moveServer(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className="p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => moveServer(index, 1)}
                disabled={index === servers.length - 1}
                aria-label="Move down"
                className="p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => removeServer(server.id)}
                aria-label="Remove MCP server"
                className="p-2 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Transport */}
            <div>
              <label className="block text-sm font-medium mb-1">Transport</label>
              <select
                value={server.transport}
                onChange={(e) =>
                  updateServer(server.id, { transport: e.target.value as DevMcpTransport })
                }
                aria-label="Transport"
                className={fieldClass}
              >
                {TRANSPORTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* stdio-specific fields */}
            {server.transport === "stdio" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Command</label>
                  <input
                    type="text"
                    value={server.command}
                    onChange={(e) => updateServer(server.id, { command: e.target.value })}
                    placeholder="npx"
                    spellCheck={false}
                    className={cn(fieldClass, "font-mono")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Arguments (one per line)</label>
                  <textarea
                    value={server.args}
                    onChange={(e) => updateServer(server.id, { args: e.target.value })}
                    placeholder={"-y\n@modelcontextprotocol/server-everything"}
                    spellCheck={false}
                    rows={3}
                    className={cn(fieldClass, "font-mono resize-y")}
                  />
                </div>
                <KeyValueEditor
                  label="Environment variables"
                  rows={server.env}
                  onChange={(rows) => updateServer(server.id, { env: rows })}
                  keyPlaceholder="NAME"
                  valuePlaceholder="value"
                />
                <div>
                  <label className="block text-sm font-medium mb-1">Working directory (optional)</label>
                  <input
                    type="text"
                    value={server.cwd}
                    onChange={(e) => updateServer(server.id, { cwd: e.target.value })}
                    placeholder="C:\\Users\\..."
                    spellCheck={false}
                    className={fieldClass}
                  />
                </div>
              </>
            )}

            {/* remote (sse/http) fields */}
            {isRemote && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Server URL</label>
                  <input
                    type="text"
                    value={server.url}
                    onChange={(e) => updateServer(server.id, { url: e.target.value })}
                    placeholder="https://example.com/mcp"
                    spellCheck={false}
                    className={cn(fieldClass, "font-mono")}
                  />
                </div>
                <KeyValueEditor
                  label="Headers"
                  rows={server.headers}
                  onChange={(rows) => updateServer(server.id, { headers: rows })}
                  keyPlaceholder="Header-Name"
                  valuePlaceholder="value"
                />
                <div>
                  <label className="block text-sm font-medium mb-1">Auth token</label>
                  <SecretInput
                    value={server.authToken}
                    onChange={(v) => updateServer(server.id, { authToken: v })}
                    placeholder="Token"
                  />
                </div>
              </>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={server.notes}
                onChange={(e) => updateServer(server.id, { notes: e.target.value })}
                placeholder="Anything you want to remember about this MCP..."
                spellCheck={false}
                rows={2}
                className={cn(fieldClass, "resize-y")}
              />
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addServer}
        className="flex items-center gap-2 px-4 py-2 rounded-md border border-input text-sm font-medium hover:bg-muted transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add MCP
      </button>
    </div>
  );
}
