## Problem Description

**Type:** Bug (Memory Leak)
**Priority:** Critical
**Likelihood:** 80%
**Impact:** App crashes after 30-60 minutes of use
**Timeline:** 2-4 weeks of normal use → noticeable slowdown; 1-2 months → crashes

GlobalStatsProvider creates its own IndexedDB connection instead of using the existing ConnectionPool, potentially leaking connections over time.

### Affected Files

- [`src/contexts/GlobalStatsContext.tsx:38-100`](src/contexts/GlobalStatsContext.tsx#L38-L100) - Direct openDB() usage
- [`src/utils/indexedDB.ts:36-186`](src/utils/indexedDB.ts#L36-L186) - Existing ConnectionPool class (not used)

### Current Implementation

**GlobalStatsProvider (Problematic):**

```typescript
export function GlobalStatsProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<IDBPDatabase<GlobalStatsDB> | null>(null);

  useEffect(() => {
    let database: IDBPDatabase<GlobalStatsDB> | null = null;
    let isMounted = true;

    const initDB = async () => {
      database = await openDB<GlobalStatsDB>(DB_NAME, DB_VERSION, {
        upgrade(db: IDBPDatabase<GlobalStatsDB>) {
          if (!db.objectStoreNames.contains(STATS_STORE)) {
            db.createObjectStore(STATS_STORE);
          }
        },
      });

      if (!isMounted) {
        database.close();
        return;
      }

      setDb(database); // ❌ Stores DB in state
    };

    initDB();

    return () => {
      isMounted = false;
      if (database) {
        database.close(); // Cleanup on unmount
      }
    };
  }, []); // ❌ Empty deps array

  const updateStats = useCallback(
    async (update: StatsUpdate) => {
      if (!db) return; // Uses db from state

      setStats((prevStats) => {
        // ... update logic
        db.put(STATS_STORE, updatedStats, STATS_KEY);
        return updatedStats;
      });
    },
    [db] // ❌ Dependency on db state
  );
}
```

**SessionContext (Correct Pattern):**

```typescript
// indexedDB.ts has a singleton connection pool
class IndexedDBConnectionPool {
  private db: IDBDatabase | null = null;

  async getConnection(): Promise<IDBDatabase> {
    if (this.db && this.db.objectStoreNames.length > 0) {
      return this.db; // Reuse existing connection
    }
    // ... create new connection only if needed
  }
}

const connectionPool = new IndexedDBConnectionPool();

export async function saveSession(session: SerializedSession): Promise<void> {
  const db = await connectionPool.getConnection(); // Uses pool
}
```

## Root Cause Analysis

1. **Separate DB Instance:** GlobalStatsProvider creates its own `openDB()` call instead of using `connectionPool.getConnection()`
2. **State Dependency:** `db` is stored in state, triggering re-renders when it changes
3. **Callback Re-creation:** `updateStats` callback depends on `[db]`, so it recreates when db changes
4. **Potential Leak:** If `setDb()` is called with a new connection before the old one closes (e.g., during reconnection), the old connection is abandoned but not closed

## Memory Leak Scenario

```
Time: 0s   - App starts, openDB() creates connection A
Time: 5s   - Connection A stored in state via setDb(A)
Time: 30m  - Network error occurs, connection A becomes invalid
Time: 30m  - useEffect cleanup hasn't run (component still mounted)
Time: 30m  - Auto-reconnect logic (if added) calls openDB() again
Time: 30m  - Connection B created, setDb(B) called
Time: 30m  - Connection A is now orphaned! (not closed, not in state)
Result: Connection A leaks until app restart
```

## Impact Analysis

**Short-term (0-2 weeks):**

- No visible issues
- Single DB connection per session

**Medium-term (2-4 weeks):**

- Network instability creates reconnections
- Each orphaned connection holds memory and file handles
- Gradual slowdown as more connections leak

**Long-term (1-2 months):**

- Dozens of leaked connections
- Browser/Electron quota errors
- App crashes with "Too many open files" or "QuotaExceededError"

## Evidence

**From indexedDB.ts:**

- Lines 36-186: Sophisticated `IndexedDBConnectionPool` class exists
- Line 189: Singleton instance: `const connectionPool = new IndexedDBConnectionPool()`
- Lines 211-244: All SessionContext functions use the pool
- **But GlobalStatsProvider doesn't use it!**

## Proposed Solution

Refactor GlobalStatsProvider to use connection pool pattern:

```typescript
// NEW: Create connection pool for GlobalStats
class GlobalStatsConnectionPool {
  private static instance: GlobalStatsConnectionPool;
  private db: IDBPDatabase<GlobalStatsDB> | null = null;

  static getInstance(): GlobalStatsConnectionPool {
    if (!GlobalStatsConnectionPool.instance) {
      GlobalStatsConnectionPool.instance = new GlobalStatsConnectionPool();
    }
    return GlobalStatsConnectionPool.instance;
  }

  async getConnection(): Promise<IDBPDatabase<GlobalStatsDB>> {
    if (this.db) {
      return this.db; // Reuse connection
    }

    this.db = await openDB<GlobalStatsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STATS_STORE)) {
          db.createObjectStore(STATS_STORE);
        }
      },
    });

    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

const statsPool = GlobalStatsConnectionPool.getInstance();

// REFACTORED Provider
export function GlobalStatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<GlobalStats>(createDefaultGlobalStats());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadStats = async () => {
      try {
        const db = await statsPool.getConnection(); // Use pool

        if (!isMounted) return;

        const existingStats = await db.get(STATS_STORE, STATS_KEY);
        // ... rest of initialization
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadStats();

    return () => {
      isMounted = false;
      // NO database.close() - pool manages lifecycle
    };
  }, []);

  const updateStats = useCallback(
    async (update: StatsUpdate) => {
      const db = await statsPool.getConnection(); // Get from pool

      setStats((prevStats) => {
        const updatedStats = { ...prevStats };
        // ... update logic
        db.put(STATS_STORE, updatedStats, STATS_KEY);
        return updatedStats;
      });
    },
    [] // No dependencies - uses pool directly
  );
}

// Cleanup on app shutdown
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    statsPool.close();
  });
}
```

## Acceptance Criteria

- [ ] GlobalStatsProvider uses connection pool pattern
- [ ] Only ONE IndexedDB connection created for GlobalStats
- [ ] Connection persists for entire app lifecycle
- [ ] No database connections leak on reconnection
- [ ] updateStats callback doesn't depend on db state
- [ ] Memory usage stable over 1+ hour session
- [ ] No "Too many open files" errors

## Testing Strategy

1. **Memory Leak Test:**
   - Run app for 1 hour with periodic stats updates
   - Monitor open file handles
   - Verify only 1 IndexedDB connection for GlobalStats exists

2. **Reconnection Test:**
   - Simulate network interruption to trigger reconnection
   - Verify no duplicate connections created
   - Check memory doesn't grow after reconnects

3. **Long-Running Test:**
   - Process 100 documents over 2 hours
   - Monitor memory usage (should be flat)
   - Verify no crashes or quota errors

## Estimated Effort

**3 hours** (1.5 hours refactoring + 1.5 hours testing and validation)

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#critical-issue-3-globalstatsprovider-indexeddb-memory-leak)
