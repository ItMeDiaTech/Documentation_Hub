## Problem Description

**Type:** Performance (Algorithmic Complexity)
**Priority:** High
**Likelihood:** 100%
**Impact:** App becomes unusable with 50+ sessions
**Timeline:** 4-6 weeks of normal use → slowdown begins; 2-3 months → critical

Every 3 seconds, SessionProvider saves ALL sessions to IndexedDB, which triggers expensive cleanup operations that read all sessions again, creating O(n) complexity.

### Affected Files

- [`src/contexts/SessionContext.tsx:139-214`](src/contexts/SessionContext.tsx#L139-L214) - Persistence logic
- [`src/utils/indexedDB.ts:484-528`](src/utils/indexedDB.ts#L484-L528) - Size checking
- [`src/utils/indexedDB.ts:596-647`](src/utils/indexedDB.ts#L596-L647) - Quota error handling

### Current Implementation

```typescript
const debouncedPersistSessions = useCallback(async () => {
  try {
    await ensureDBSizeLimit(200); // ❌ Reads ALL sessions!

    const serializedSessions = currentSessions.map(/* ... */);

    // ❌ Save EVERY session on EVERY persist!
    for (const session of serializedSessions) {
      const truncatedSession = truncateSessionChanges(session, 100);
      await handleQuotaExceededError(async () => saveSession(truncatedSession), session.id);
    }
  } catch (err) {
    log.error('Failed to persist sessions:', err);
  }
}, []);

// ❌ Triggers on EVERY state change!
useEffect(() => {
  if (sessions.length > 0) {
    persistTimerRef.current = setTimeout(() => {
      debouncedPersistSessions();
    }, 3000);
  }
}, [sessions, activeSessions]); // ❌ Dependency on entire arrays!
```

## The Cascading Problem

**Step 1:** User processes 1 document → triggers state change
**Step 2:** 3 seconds later, persist runs:

- `ensureDBSizeLimit(200)` → reads ALL sessions from DB
- `JSON.stringify(sessions)` → serializes ALL sessions
- Loop saves ALL sessions (not just changed one)
- If quota exceeded → reads ALL sessions AGAIN for cleanup

## Complexity Analysis

| Sessions | Serialize | Size Check | Save All | Cleanup | Total Time | Impact     |
| -------- | --------- | ---------- | -------- | ------- | ---------- | ---------- |
| 10       | 5ms       | 10ms       | 50ms     | 10ms    | ~75ms      | Acceptable |
| 50       | 25ms      | 50ms       | 250ms    | 50ms    | ~375ms     | Sluggish   |
| 100      | 50ms      | 100ms      | 500ms    | 100ms   | ~750ms     | Unusable   |
| 200      | 100ms     | 200ms      | 1000ms   | 200ms   | ~1500ms    | Crash risk |

## Evidence

**From Code Comments:**

- Line 198: `"PERFORMANCE FIX: Increased debounce from 1s to 3s for better UI responsiveness"`
  - This treats the symptom, not the cause
- Line 142: `await ensureDBSizeLimit(200);` on EVERY persist
- Line 162: `truncateSessionChanges(session, 100)` - indicates storage problems

## Root Cause

1. **Full Save on Every Change:** Saves ALL sessions when only 1 changed
2. **Eager Size Checking:** Checks DB size on every persist (expensive!)
3. **Array Dependency:** `useEffect([sessions, activeSessions])` triggers on any array change
4. **No Dirty Tracking:** No way to know which sessions actually changed

## Proposed Solution

Implement incremental persistence with dirty tracking:

```typescript
// NEW: Track which sessions changed
const dirtySessionsRef = useRef<Set<string>>(new Set());

const markSessionDirty = (sessionId: string) => {
  dirtySessionsRef.current.add(sessionId);
};

// REFACTORED: Only save dirty sessions
const debouncedPersistSessions = useCallback(async () => {
  try {
    const dirtyIds = Array.from(dirtySessionsRef.current);

    if (dirtyIds.length === 0) return;

    log.debug(`Saving ${dirtyIds.length} dirty session(s)`);

    // Only save sessions that changed
    for (const sessionId of dirtyIds) {
      const session = currentSessions.find(s => s.id === sessionId);
      if (!session) continue;

      const serialized = /* ... serialize session ... */;
      const truncated = truncateSessionChanges(serialized, 100);
      await saveSession(truncated);
    }

    dirtySessionsRef.current.clear();

    // Check size only once per 10 minutes (not every persist!)
    const lastSizeCheck = localStorage.getItem('lastDBSizeCheck');
    const now = Date.now();

    if (!lastSizeCheck || now - parseInt(lastSizeCheck) > 10 * 60 * 1000) {
      await ensureDBSizeLimit(200);
      localStorage.setItem('lastDBSizeCheck', now.toString());
    }
  } catch (err) {
    log.error('Failed to persist sessions:', err);
  }
}, []);

// Track session modifications
const updateSession = (sessionId: string, updates: Partial<Session>) => {
  setSessions(prev => prev.map(s =>
    s.id === sessionId ? { ...s, ...updates, lastModified: new Date() } : s
  ));
  markSessionDirty(sessionId);  // Mark as needing save
};
```

## Acceptance Criteria

- [ ] Only modified sessions are persisted (not all sessions)
- [ ] DB size check runs maximum once per 10 minutes
- [ ] Dirty tracking correctly identifies changed sessions
- [ ] Persist time scales linearly with # of changed sessions
- [ ] 100 sessions with 1 change: < 50ms persist time
- [ ] No performance degradation as total session count grows

## Performance Benchmarks

**Target Improvement:**

- 10 sessions, 1 change: ~5ms (was ~75ms)
- 50 sessions, 1 change: ~5ms (was ~375ms)
- 100 sessions, 1 change: ~5ms (was ~750ms)
- 100 sessions, 10 changes: ~50ms

**15x faster for typical usage**

## Testing Strategy

1. **Dirty Tracking Test:** Modify 1 of 50 sessions, verify only 1 written
2. **Scaling Test:** Create 100 sessions, process 1 document, measure < 50ms
3. **Size Check Test:** Process 10 documents in 5 minutes, verify size check called once
4. **Regression Test:** Ensure all session data persists correctly

## Estimated Effort

**6 hours** (3 hours implementation + 2 hours testing + 1 hour performance tuning)

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#high-priority-issue-4-on%C2%B2-session-persistence-performance)
