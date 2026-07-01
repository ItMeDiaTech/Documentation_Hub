import { useState } from "react";
import { Send } from "lucide-react";
import { useUserSettings } from "@/contexts/UserSettingsContext";
import type { DevAuthType, DevHttpMethod, DevHttpSettings } from "@/types/settings";
import { buildDevRequest, buildDevRequestUrl } from "@/utils/devHttp";
import { cn } from "@/utils/cn";
import { KeyValueEditor } from "./KeyValueEditor";
import { SecretInput } from "./SecretInput";

const METHODS: DevHttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const AUTH_LABELS: Record<DevAuthType, string> = {
  none: "None",
  basic: "Basic (username + password)",
  token: "Nuxeo token (X-Authentication-Token)",
  bearer: "Bearer token",
};

interface DevHttpResponseState {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  durationMs: number;
  error?: string;
}

const fieldClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20";

/**
 * Generic HTTP request builder for testing the Nuxeo document store. Every field
 * is persisted to user settings on change (auto-save). The request is sent
 * through the main-process `dev:http-request` IPC so it uses the same
 * proxy/certificate-aware networking stack as the rest of the app.
 */
export function HttpRequestWorkbench() {
  const { settings, updateDevEnvSettings } = useUserSettings();
  const http = settings.devEnv.http;

  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<DevHttpResponseState | null>(null);

  const patch = (updates: Partial<DevHttpSettings>) => updateDevEnvSettings({ http: updates });

  const previewUrl = buildDevRequestUrl(http.baseUrl, http.path, http.params);

  const send = async () => {
    if (typeof window.electronAPI?.dev?.httpRequest !== "function") {
      setResponse({ ok: false, durationMs: 0, error: "Dev HTTP bridge unavailable (browser mode)" });
      return;
    }
    setSending(true);
    setResponse(null);
    try {
      const request = buildDevRequest(http);
      const result = await window.electronAPI.dev.httpRequest({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body,
        timeoutMs: http.timeoutMs,
      });
      setResponse(result);
    } catch (error) {
      setResponse({
        ok: false,
        durationMs: 0,
        error: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Connection */}
      <div className="space-y-3">
        <div>
          <label htmlFor="dev-base-url" className="block text-sm font-medium mb-1">
            Base URL
          </label>
          <input
            id="dev-base-url"
            type="text"
            value={http.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder="https://your-host/nuxeo"
            spellCheck={false}
            className={cn(fieldClass, "font-mono")}
          />
        </div>

        <div className="flex gap-2">
          <select
            aria-label="HTTP method"
            value={http.method}
            onChange={(e) => patch({ method: e.target.value as DevHttpMethod })}
            className={cn(fieldClass, "w-32 shrink-0 font-mono")}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            aria-label="Request path or URL"
            type="text"
            value={http.path}
            onChange={(e) => patch({ path: e.target.value })}
            placeholder="/api/v1/query?query=SELECT * FROM Document   (or a full URL)"
            spellCheck={false}
            className={cn(fieldClass, "flex-1 font-mono")}
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !previewUrl}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
          >
            <Send className="w-4 h-4" />
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
        {previewUrl && (
          <p className="text-xs text-muted-foreground font-mono break-all">→ {previewUrl}</p>
        )}
      </div>

      {/* Auth */}
      <div className="space-y-2 border-t border-border pt-4">
        <label htmlFor="dev-auth-type" className="block text-sm font-medium">
          Authentication
        </label>
        <select
          id="dev-auth-type"
          value={http.authType}
          onChange={(e) => patch({ authType: e.target.value as DevAuthType })}
          className={fieldClass}
        >
          {(Object.keys(AUTH_LABELS) as DevAuthType[]).map((t) => (
            <option key={t} value={t}>
              {AUTH_LABELS[t]}
            </option>
          ))}
        </select>
        {http.authType === "basic" && (
          <input
            aria-label="Username"
            type="text"
            value={http.authUsername}
            onChange={(e) => patch({ authUsername: e.target.value })}
            placeholder="Username"
            spellCheck={false}
            className={cn(fieldClass, "font-mono")}
          />
        )}
        {http.authType !== "none" && (
          <SecretInput
            value={http.authSecret}
            onChange={(v) => patch({ authSecret: v })}
            placeholder={http.authType === "basic" ? "Password" : "Token"}
          />
        )}
      </div>

      {/* Query params */}
      <div className="border-t border-border pt-4">
        <KeyValueEditor
          label="Query parameters"
          rows={http.params}
          onChange={(rows) => patch({ params: rows })}
          keyPlaceholder="name"
          valuePlaceholder="value"
        />
      </div>

      {/* Headers */}
      <div className="border-t border-border pt-4">
        <KeyValueEditor
          label="Headers"
          rows={http.headers}
          onChange={(rows) => patch({ headers: rows })}
          keyPlaceholder="Header-Name"
          valuePlaceholder="value"
        />
      </div>

      {/* Body */}
      <div className="border-t border-border pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="dev-body" className="text-sm font-medium">
            Request body
          </label>
          <span className="text-xs text-muted-foreground">
            {http.method === "GET"
              ? "Ignored for GET"
              : "Sent as-is (set Content-Type in Headers)"}
          </span>
        </div>
        <textarea
          id="dev-body"
          value={http.body}
          onChange={(e) => patch({ body: e.target.value })}
          placeholder={'{\n  "input": "doc:/default-domain",\n  "params": {}\n}'}
          spellCheck={false}
          rows={6}
          className={cn(fieldClass, "font-mono resize-y")}
        />
      </div>

      {/* Timeout */}
      <div className="border-t border-border pt-4">
        <label htmlFor="dev-timeout" className="block text-sm font-medium mb-1">
          Timeout (ms)
        </label>
        <input
          id="dev-timeout"
          type="number"
          min={1000}
          max={120000}
          step={1000}
          value={http.timeoutMs}
          onChange={(e) => patch({ timeoutMs: Number(e.target.value) || 45000 })}
          className={cn(fieldClass, "w-40 font-mono")}
        />
      </div>

      {/* Response */}
      {response && (
        <div className="border-t border-border pt-4 space-y-2">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "px-2 py-0.5 rounded text-xs font-semibold",
                response.ok
                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                  : "bg-destructive/15 text-destructive"
              )}
            >
              {response.error
                ? "ERROR"
                : `${response.status ?? "?"} ${response.statusText ?? ""}`.trim()}
            </span>
            <span className="text-xs text-muted-foreground">{response.durationMs} ms</span>
          </div>

          {response.error && <p className="text-sm text-destructive">{response.error}</p>}

          {response.headers && Object.keys(response.headers).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Response headers</summary>
              <pre className="mt-1 p-2 rounded bg-muted/50 overflow-x-auto font-mono">
                {Object.entries(response.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
              </pre>
            </details>
          )}

          {response.body !== undefined && (
            <pre className="p-3 rounded-md bg-muted/50 overflow-auto max-h-96 text-xs font-mono whitespace-pre-wrap break-all">
              {formatBody(response.body)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Pretty-print a JSON response body; fall back to the raw text otherwise. */
function formatBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "(empty response)";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return body;
  }
}
