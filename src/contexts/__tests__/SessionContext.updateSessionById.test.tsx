/**
 * Tests for SessionContext.updateSessionById tri-state synchronization.
 *
 * Per Task 9, updateSessionById is the single funnel that mutates session
 * state across:
 *   - sessions          (full history)
 *   - activeSessions    (currently open)
 *   - currentSession    (focused tab)
 *
 * Any one of the wrapper updaters (updateSessionStats, updateSessionName,
 * etc.) MUST keep all three in lock-step after a single call.
 *
 * GATED: `@testing-library/react@16` requires `@testing-library/dom` as a
 * peer dependency that is not currently installed. The pre-existing
 * GlobalStatsContext.test.tsx is blocked by the same gap. Task 12 should
 * install @testing-library/dom; this test will then run.
 *
 * Until then we use describe.skip so jest reports the suite as skipped
 * rather than failing the run.
 */

import React from "react";

const canRunReactHookTests = (() => {
  try {
    require.resolve("@testing-library/dom");
    return true;
  } catch {
    return false;
  }
})();

const maybeDescribe = canRunReactHookTests ? describe : describe.skip;

// Lazy imports — only resolve react-testing-library bindings if the peer
// dep is present, otherwise the test is skipped.
let act: any;
let cleanup: any;
let renderHook: any;
let waitFor: any;
let SessionProvider: any;
let useSession: any;
let GlobalStatsProvider: any;
let indexedDB: typeof import("@/utils/indexedDB");

if (canRunReactHookTests) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rtl = require("@testing-library/react");
  act = rtl.act;
  cleanup = rtl.cleanup;
  renderHook = rtl.renderHook;
  waitFor = rtl.waitFor;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SessionProvider = require("../SessionContext").SessionProvider;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useSession = require("../SessionContext").useSession;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GlobalStatsProvider = require("../GlobalStatsContext").GlobalStatsProvider;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  indexedDB = require("@/utils/indexedDB");
}

// ─── Mocks ───────────────────────────────────────────────────────────

jest.mock("@/utils/indexedDB", () => ({
  loadSessions: jest.fn(),
  saveSession: jest.fn(),
  deleteSession: jest.fn(),
  ensureDBSizeLimit: jest.fn(),
  handleQuotaExceededError: jest.fn(),
  migrateFromLocalStorage: jest.fn(),
  truncateSessionChanges: jest.fn(),
  loadGlobalStats: jest.fn(),
  saveGlobalStats: jest.fn(),
  resetGlobalStats: jest.fn(),
  getGlobalStatsConnectionPool: jest.fn().mockReturnValue({
    getConnection: jest.fn(),
    close: jest.fn(),
    getStats: jest.fn().mockReturnValue({ connected: true, reconnectAttempts: 0, lastError: null }),
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    namespace: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
  logger: {
    namespace: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
  debugModes: { SESSION_STATE: "SESSION_STATE" },
  isDebugEnabled: () => false,
  createDebugLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// ─── Test ────────────────────────────────────────────────────────────

maybeDescribe("SessionContext.updateSessionById tri-state sync", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (indexedDB.loadSessions as jest.Mock).mockResolvedValue([]);
    (indexedDB.saveSession as jest.Mock).mockResolvedValue(undefined);
    (indexedDB.deleteSession as jest.Mock).mockResolvedValue(undefined);
    (indexedDB.loadGlobalStats as jest.Mock).mockResolvedValue(null);
    (indexedDB.saveGlobalStats as jest.Mock).mockResolvedValue(undefined);
    (indexedDB.migrateFromLocalStorage as jest.Mock).mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("a single updateSessionStats call mutates sessions, activeSessions, and currentSession atomically", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <GlobalStatsProvider>
        <SessionProvider>{children}</SessionProvider>
      </GlobalStatsProvider>
    );
    const { result } = renderHook(() => useSession(), { wrapper });

    // Wait for initial load.
    await waitFor(() => {
      expect(indexedDB.loadSessions).toHaveBeenCalled();
    });

    // Create a session so all three state slots have it.
    let sessionId = "";
    act(() => {
      const created = result.current.createSession("test-session");
      sessionId = created.id;
    });

    // Sanity: the new session is the current session AND lives in both lists.
    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe(sessionId);
      expect(result.current.activeSessions.some((s: any) => s.id === sessionId)).toBe(true);
      expect(result.current.sessions.some((s: any) => s.id === sessionId)).toBe(true);
    });

    // One call through updateSessionById (via updateSessionStats).
    act(() => {
      result.current.updateSessionStats(sessionId, {
        documentsProcessed: 7,
        hyperlinksChecked: 42,
      });
    });

    // All three state slots must now agree on the new stats.
    const sessionInSessions = result.current.sessions.find((s: any) => s.id === sessionId);
    const sessionInActive = result.current.activeSessions.find((s: any) => s.id === sessionId);
    const sessionInCurrent = result.current.currentSession;

    expect(sessionInSessions?.stats.documentsProcessed).toBe(7);
    expect(sessionInSessions?.stats.hyperlinksChecked).toBe(42);

    expect(sessionInActive?.stats.documentsProcessed).toBe(7);
    expect(sessionInActive?.stats.hyperlinksChecked).toBe(42);

    expect(sessionInCurrent?.id).toBe(sessionId);
    expect(sessionInCurrent?.stats.documentsProcessed).toBe(7);
    expect(sessionInCurrent?.stats.hyperlinksChecked).toBe(42);
  });
});
