import { useState } from "react";
import { Cable, Globe, TerminalSquare, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { cn } from "@/utils/cn";
import { HttpRequestWorkbench } from "@/components/dev/HttpRequestWorkbench";
import { TerminalPanel } from "@/components/dev/TerminalPanel";
import { McpTunnelForm } from "@/components/dev/McpTunnelForm";

type DevTab = "http" | "terminal" | "mcp";

const TABS: { id: DevTab; label: string; icon: typeof Globe }[] = [
  { id: "http", label: "Nuxeo HTTP", icon: Globe },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "mcp", label: "MCP Tunnel", icon: Cable },
];

/**
 * Developer-only workbench, reachable from the "Dev Env" sidebar section that
 * only appears when the Development toggle (Settings → Development) is on. If the
 * toggle is off (e.g. via a stale route), it shows a short notice instead.
 */
export function DevEnv() {
  const { settings } = useUserSettings();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DevTab>("http");

  if (!settings.devEnv.enabled) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center max-w-md">
          <Wrench className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Development mode is off</h2>
          <p className="text-muted-foreground mb-4">
            Turn on the Development toggle in Settings to use these tools.
          </p>
          <button
            type="button"
            onClick={() => navigate("/settings?section=development")}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Wrench className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Dev Env</h1>
          <p className="text-sm text-muted-foreground">
            Developer tools for testing endpoints and tooling. Inputs are saved automatically.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background/50 p-5">
        {tab === "http" && <HttpRequestWorkbench />}
        {tab === "terminal" && <TerminalPanel />}
        {tab === "mcp" && <McpTunnelForm />}
      </div>
    </div>
  );
}
