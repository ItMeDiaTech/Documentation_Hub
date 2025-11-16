## Problem Description

**Type:** Performance (Synchronous Blocking)
**Priority:** Critical
**Likelihood:** 90%
**Impact:** 3-5 second white screen on every app launch
**Timeline:** **ALREADY HAPPENING** - worse as database grows

Four nested context providers execute synchronous initialization in the render path, blocking React from rendering anything until ALL providers complete initialization.

### Affected Files

- [`src/App.tsx:114-124`](src/App.tsx#L114-L124) - Provider nesting structure
- [`src/contexts/ThemeContext.tsx:53-146`](src/contexts/ThemeContext.tsx#L53-L146) - 17× localStorage reads
- [`src/contexts/UserSettingsContext.tsx:123-125`](src/contexts/UserSettingsContext.tsx#L123-L125) - Settings load
- [`src/contexts/GlobalStatsContext.tsx:38-100`](src/contexts/GlobalStatsContext.tsx#L38-L100) - IndexedDB initialization
- [`src/contexts/SessionContext.tsx:44-125`](src/contexts/SessionContext.tsx#L44-L125) - Session loading + migration

### Current Implementation

```typescript
<ErrorBoundary>
  <ThemeProvider>           {/* 17× localStorage reads! */}
    <UserSettingsProvider>  {/* localStorage + JSON parse */}
      <GlobalStatsProvider>  {/* IndexedDB open + read */}
        <SessionProvider>     {/* IndexedDB open + migration + cleanup */}
          <RouterProvider router={router} />
```

### Initialization Sequence Breakdown

**1. ThemeProvider:** ~85-170ms

- 17× `localStorage.getItem()` calls in `useState` initializers
- Each read takes ~5-10ms

**2. UserSettingsProvider:** ~10-20ms

- Reads 'userSettings' from localStorage
- JSON parsing

**3. GlobalStatsProvider:** ~100-300ms

- Opens IndexedDB connection
- Reads existing stats
- Performs date rollover calculations
- **Very slow operation!**

**4. SessionProvider:** ~200-500ms (or **2-5 seconds with migration!**)

- Checks localStorage for old sessions
- **Migrates from localStorage to IndexedDB** if needed
- Loads ALL sessions from IndexedDB
- Deserializes dates for each session
- Cleans up sessions >30 days old
- Deletes old sessions from database

**Total Blocking Time:**

- **Best Case:** 400-1000ms of white/black screen
- **Migration Scenario:** **3-5 seconds** of frozen UI
- **With 50+ Sessions:** 1.5-3 seconds

## Root Cause

All context providers use **synchronous initialization** in `useState` initializers or immediate `useEffect` calls. React **cannot render anything** until all providers complete their setup, blocking the entire UI thread.

## Impact on Users

### First Launch (Clean Install)

1. User clicks app icon
2. Electron window opens (black screen, `backgroundColor: '#0a0a0a'`)
3. **400-1000ms pass** while contexts initialize
4. Finally, React UI appears

### Migration Scenario (Upgrading from localStorage)

1. User clicks app icon
2. Black screen appears
3. **3-5 SECONDS pass** while migration runs
4. No loading indicator, no progress bar
5. User thinks app is frozen

### Normal Launch (With 50+ Sessions)

1. User clicks app icon
2. Black screen
3. **1.5-3 seconds** while all sessions load and deserialize
4. UI finally appears

## Evidence of Existing Issues

From code comments:

- Line 198 in SessionContext: `"PERFORMANCE FIX: Increased debounce from 1s to 3s for better UI responsiveness"` - persistence was too slow!
- Line 199: "This reduces database writes during active editing (drag-drop, processing, etc.) and makes the UI feel much snappier" - clear performance problem

### Scaling Analysis

- 10 sessions: ~500ms load time (acceptable)
- 50 sessions: ~1.5s load time (sluggish)
- 100 sessions: ~3s+ load time (unusable)
- 200 sessions: ~5s+ load time (critical)

## Proposed Solution

Implement **lazy context initialization** with loading states:

```typescript
// NEW: Deferred provider pattern
function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>        {/* Only theme - needed for initial colors */}
        <AppShell />         {/* Shows loading UI immediately */}
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function AppShell() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Initialize heavy contexts in background
    Promise.all([
      initUserSettings(),
      initGlobalStats(),
      initSessions(),
    ]).then(() => {
      setIsReady(true);
    });
  }, []);

  if (!isReady) {
    return <SplashScreen />;  // Beautiful loading UI
  }

  return (
    <UserSettingsProvider>
      <GlobalStatsProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </GlobalStatsProvider>
    </UserSettingsProvider>
  );
}
```

### Alternative: Code Splitting

```typescript
// Lazy load heavy providers
const SessionProvider = lazy(() => import('@/contexts/SessionContext'));
const GlobalStatsProvider = lazy(() => import('@/contexts/GlobalStatsContext'));

<Suspense fallback={<SplashScreen />}>
  <SessionProvider>
    <GlobalStatsProvider>
      <RouterProvider />
    </GlobalStatsProvider>
  </SessionProvider>
</Suspense>
```

## Acceptance Criteria

- [ ] App shows UI within 200ms of window creation
- [ ] Loading indicator displayed during context initialization
- [ ] Migration progress shown to user (if applicable)
- [ ] Session loading paginated (load 20 at a time, not all at once)
- [ ] ThemeProvider loads synchronously (needed for colors)
- [ ] Other providers load asynchronously with Suspense
- [ ] No white/black screen longer than 200ms

## Performance Benchmarks

**Target Performance:**

- Cold start (no data): < 300ms to interactive
- Normal start (10 sessions): < 500ms to interactive
- Heavy load (100 sessions): < 1000ms to interactive
- Migration: Progress indicator visible within 200ms

## Testing Strategy

1. **Benchmark Test:** Measure time from window creation to first paint
2. **Migration Test:** Import large localStorage dataset, verify progress shown
3. **Scaling Test:** Create 100 dummy sessions, verify load time < 1s
4. **Regression Test:** Ensure all context data still loads correctly

## Estimated Effort

**4 hours** (2 hours implementation + 2 hours testing + performance tuning)

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#critical-issue-2-context-provider-cascade-blocks-initial-render)
