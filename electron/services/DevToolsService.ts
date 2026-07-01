/**
 * DevToolsService - Main-process helpers for the Development Environment.
 *
 * Two capabilities, both driven entirely by input the local developer types
 * into the (default-off) Dev Env screen:
 *  - `runDevHttpRequest`: a generic HTTP request via Electron `net.request`, so
 *    it uses Chromium's networking stack and respects the system proxy / custom
 *    certificates (the same reason the Power Automate calls go through the main
 *    process). Used to hit the Nuxeo document store while testing endpoints.
 *  - `runDevCommand`: run a single PowerShell command and capture its output.
 *
 * These are powerful, so both are hardened: the URL must be http(s), timeouts
 * are bounded, and captured output is size-capped.
 */
import { net, session } from "electron";
import { logger } from "../../src/utils/logger";

const log = logger.namespace("DevTools");

const MIN_TIMEOUT_MS = 1000;
const MAX_HTTP_TIMEOUT_MS = 120000;
const DEFAULT_HTTP_TIMEOUT_MS = 45000;
const MAX_CMD_TIMEOUT_MS = 300000;
const DEFAULT_CMD_TIMEOUT_MS = 60000;
const MAX_OUTPUT_BYTES = 1_000_000; // 1 MB cap per stream

function clampTimeout(value: number | undefined, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(n, MIN_TIMEOUT_MS), max);
}

export interface DevHttpRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface DevHttpResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  durationMs: number;
  error?: string;
}

/** Perform an arbitrary HTTP request through the Chromium networking stack. */
export function runDevHttpRequest(input: DevHttpRequestInput): Promise<DevHttpResponse> {
  const start = Date.now();
  const method = String(input?.method || "GET").toUpperCase();
  const url = String(input?.url || "").trim();
  const timeoutMs = clampTimeout(input?.timeoutMs, DEFAULT_HTTP_TIMEOUT_MS, MAX_HTTP_TIMEOUT_MS);

  if (!/^https?:\/\//i.test(url)) {
    return Promise.resolve({
      ok: false,
      durationMs: 0,
      error: "URL must start with http:// or https://",
    });
  }

  return new Promise<DevHttpResponse>((resolve) => {
    let settled = false;
    const finish = (result: DevHttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let request: Electron.ClientRequest;
    try {
      request = net.request({ method, url, session: session.defaultSession });
    } catch (error) {
      resolve({
        ok: false,
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Failed to create request",
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        request.abort();
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        durationMs: Date.now() - start,
        error: `Request timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    for (const [key, value] of Object.entries(input?.headers ?? {})) {
      if (key && typeof value === "string") {
        try {
          request.setHeader(key, value);
        } catch {
          /* skip invalid header names */
        }
      }
    }

    let responseData = "";
    request.on("response", (response) => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) {
        headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      response.on("data", (chunk) => {
        if (responseData.length < MAX_OUTPUT_BYTES) responseData += chunk.toString();
      });
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        finish({
          ok: status >= 200 && status < 400,
          status,
          statusText: response.statusMessage,
          headers,
          body: responseData,
          durationMs: Date.now() - start,
        });
      });
      response.on("error", (error: Error) => {
        finish({ ok: false, durationMs: Date.now() - start, error: error.message });
      });
    });

    request.on("error", (error) => {
      finish({ ok: false, durationMs: Date.now() - start, error: error.message });
    });

    const body = input?.body ?? "";
    if (body && method !== "GET" && method !== "HEAD") {
      request.write(body);
    }
    request.end();
  });
}

export interface DevCommandInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface DevCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

/** Run a single PowerShell command and capture stdout/stderr (one-shot). */
export async function runDevCommand(input: DevCommandInput): Promise<DevCommandResult> {
  const start = Date.now();
  const command = String(input?.command || "").trim();
  const timeoutMs = clampTimeout(input?.timeoutMs, DEFAULT_CMD_TIMEOUT_MS, MAX_CMD_TIMEOUT_MS);
  const cwd =
    typeof input?.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;

  if (!command) {
    return { ok: false, code: null, stdout: "", stderr: "", durationMs: 0, error: "No command provided" };
  }

  const { spawn } = await import("node:child_process");

  return new Promise<DevCommandResult>((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (result: DevCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child: import("node:child_process").ChildProcess;
    try {
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        cwd,
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : "Failed to start command",
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        // On Windows child.kill() reaps only powershell.exe, leaving any
        // descendants it spawned orphaned — kill the whole tree instead.
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
        } else {
          child.kill();
        }
      } catch {
        /* ignore */
      }
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        error: `Command timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on("data", (data) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += data.toString();
    });
    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        error: error.message,
      });
    });
    child.on("close", (code) => {
      log.info(`[DevTools] command exited with code ${code} in ${Date.now() - start}ms`);
      finish({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - start });
    });
  });
}
