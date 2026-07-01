import { useState } from "react";
import { Play } from "lucide-react";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import { cn } from "@/utils/cn";

interface CommandResultState {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

const fieldClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 font-mono";

/**
 * One-shot PowerShell command runner. The command and working directory are
 * persisted; the captured output is shown read-only. This is not an interactive
 * shell — each run spawns a fresh PowerShell, runs the command, and returns.
 */
export function TerminalPanel() {
  const { settings, updateDevEnvSettings } = useUserSettings();
  const terminal = settings.devEnv.terminal;

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandResultState | null>(null);

  const patch = (updates: Partial<typeof terminal>) =>
    updateDevEnvSettings({ terminal: updates });

  const run = async () => {
    const command = terminal.lastCommand.trim();
    if (!command) return;
    if (typeof window.electronAPI?.dev?.runCommand !== "function") {
      setResult({
        ok: false,
        code: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: "Dev command bridge unavailable (browser mode)",
      });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await window.electronAPI.dev.runCommand({
        command,
        cwd: terminal.cwd.trim() || undefined,
      });
      setResult(res);
    } catch (error) {
      setResult({
        ok: false,
        code: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        error: error instanceof Error ? error.message : "Command failed",
      });
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void run();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Runs a single PowerShell command and shows its output. Not an interactive session.
      </p>

      <div>
        <label htmlFor="dev-cwd" className="block text-sm font-medium mb-1">
          Working directory (optional)
        </label>
        <input
          id="dev-cwd"
          type="text"
          value={terminal.cwd}
          onChange={(e) => patch({ cwd: e.target.value })}
          placeholder="C:\\Users\\..."
          spellCheck={false}
          className={fieldClass}
        />
      </div>

      <div>
        <label htmlFor="dev-command" className="block text-sm font-medium mb-1">
          Command
        </label>
        <div className="flex gap-2">
          <input
            id="dev-command"
            type="text"
            value={terminal.lastCommand}
            onChange={(e) => patch({ lastCommand: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder="Get-Location"
            spellCheck={false}
            className={cn(fieldClass, "flex-1")}
          />
          <button
            type="button"
            onClick={run}
            disabled={running || !terminal.lastCommand.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
          >
            <Play className="w-4 h-4" />
            {running ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "px-2 py-0.5 rounded text-xs font-semibold",
                result.ok
                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                  : "bg-destructive/15 text-destructive"
              )}
            >
              {result.error ? "ERROR" : `exit ${result.code}`}
            </span>
            <span className="text-xs text-muted-foreground">{result.durationMs} ms</span>
          </div>
          {result.error && <p className="text-sm text-destructive">{result.error}</p>}
          {result.stdout && (
            <pre className="p-3 rounded-md bg-muted/50 overflow-auto max-h-72 text-xs font-mono whitespace-pre-wrap break-all">
              {result.stdout}
            </pre>
          )}
          {result.stderr && (
            <pre className="p-3 rounded-md bg-destructive/10 text-destructive overflow-auto max-h-48 text-xs font-mono whitespace-pre-wrap break-all">
              {result.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
