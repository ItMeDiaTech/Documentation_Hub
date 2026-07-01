import { Info } from "lucide-react";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { cn } from "@/utils/cn";
import { SecretInput } from "./SecretInput";

const fieldClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

const TRANSPORTS = ["sse", "http", "stdio"];

/**
 * Configuration form for a tunneled MCP server. This only stores the connection
 * details so they survive a restart — actually establishing the tunnel/connection
 * is intentionally out of scope for now (framework only).
 */
export function McpTunnelForm() {
  const { settings, updateDevEnvSettings } = useUserSettings();
  const mcp = settings.devEnv.mcpTunnel;

  const patch = (updates: Partial<typeof mcp>) =>
    updateDevEnvSettings({ mcpTunnel: updates });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3">
        <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground">
          This stores the tunnel details only. Connecting to it is not wired up yet — that&apos;s a
          later step.
        </p>
      </div>

      <div>
        <label htmlFor="mcp-name" className="block text-sm font-medium mb-1">
          Name
        </label>
        <input
          id="mcp-name"
          type="text"
          value={mcp.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="work-tunnel"
          spellCheck={false}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor="mcp-url" className="block text-sm font-medium mb-1">
          Server URL
        </label>
        <input
          id="mcp-url"
          type="text"
          value={mcp.url}
          onChange={(e) => patch({ url: e.target.value })}
          placeholder="https://tunnel.example.com/mcp"
          spellCheck={false}
          className={cn(fieldClass, "font-mono")}
        />
      </div>

      <div>
        <label htmlFor="mcp-transport" className="block text-sm font-medium mb-1">
          Transport
        </label>
        <select
          id="mcp-transport"
          value={mcp.transport}
          onChange={(e) => patch({ transport: e.target.value })}
          className={fieldClass}
        >
          {TRANSPORTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="mcp-token" className="block text-sm font-medium mb-1">
          Auth token
        </label>
        <SecretInput
          id="mcp-token"
          value={mcp.authToken}
          onChange={(v) => patch({ authToken: v })}
          placeholder="Token"
        />
      </div>

      <div>
        <label htmlFor="mcp-notes" className="block text-sm font-medium mb-1">
          Notes
        </label>
        <textarea
          id="mcp-notes"
          value={mcp.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Anything you want to remember about this tunnel..."
          spellCheck={false}
          rows={3}
          className={cn(fieldClass, "resize-y")}
        />
      </div>
    </div>
  );
}
