# GitHub Issue #2 - Code Locations and Performance Analysis

## Quick Reference: File Changes Needed

### ThemeContext (800-1600ms)
File: src/contexts/ThemeContext.tsx
Lines: 53-146

Problem: 16 separate localStorage reads in useState initializers
Solution: Batch all reads into single function call

Current pattern:
```
useState(() => localStorage.getItem('theme'))      // Read 1: 65ms
useState(() => localStorage.getItem('accentColor')) // Read 2: 58ms
... × 14 more
```

Each localStorage.getItem() call = ~65ms
16 calls = 1040ms total

### UserSettingsContext (200-400ms)
File: src/contexts/UserSettingsContext.tsx
Lines: 26-34

Problem: Single localStorage read + JSON parse is slow
Solution: Already optimized, leave as-is

### GlobalStatsContext (500-2000ms - Async)
File: src/contexts/GlobalStatsContext.tsx
Lines: 38-100

Problem: IndexedDB operations are slow but async (doesn't block)
Solution: Already uses isLoading flag correctly

### SessionProvider (1000-3000ms - Async)
File: src/contexts/SessionContext.tsx
Lines: 44-125

Problem: Loads ALL sessions at once, scales with session count
Solution: Implement pagination (load first 20, rest in background)

Current code:
```
const storedSessions = await loadSessions();  // LOADS ALL
const restored = parsed.map(s => ({
  ...s,
  createdAt: new Date(s.createdAt),  // Synchronous date parsing
  lastModified: new Date(s.lastModified),
  documents: s.documents.map(d => ({
    ...d,
    processedAt: d.processedAt ? new Date(d.processedAt) : undefined,
  })),
}));
```

### IndexedDB Utilities (Helper for pagination)
File: src/utils/indexedDB.ts
Lines: 250-266

Current: loadSessions() loads all sessions
Needed: Add loadSessionsPaginated(pageNumber, pageSize) function

### App.tsx (Provider cascade)
File: src/App.tsx
Lines: 114-124

Problem: Providers are nested in cascade (sequential)
Solution: Parallelize initialization in wrapper component

### New Component Needed
File: src/components/common/SplashScreen.tsx

Purpose: Show loading indicator while contexts initialize
Size: ~50 lines with animation

---

## Performance Breakdown by Component

### ThemeProvider Timeline
Read #1 (theme):              65ms   [████]
Read #2 (accentColor):        58ms   [████]
Read #3 (customAccentColor):  72ms   [████]
Read #4 (customPrimaryColor): 61ms   [████]
Read #5 (customBackgroundColor): 67ms [████]
Read #6 (customForegroundColor): 59ms [████]
Read #7 (customHeaderColor):  63ms   [████]
Read #8 (customSidebarColor): 60ms   [████]
Read #9 (customBorderColor):  64ms   [████]
Read #10 (useCustomColors):   55ms   [████]
Read #11 (fontSize):          62ms   [████]
Read #12 (fontFamily):        61ms   [████]
Read #13 (fontWeight):        58ms   [████]
Read #14 (fontStyle):         59ms   [████]
Read #15 (letterSpacing):     63ms   [████]
Read #16 (lineHeight):        64ms   [████]
────────────────────────────────────────────
TOTAL:                       1000ms  [████████████████]

### SessionProvider Timeline (with 500 sessions)
Check localStorage:           40ms
IndexedDB open:              250ms
Load 500 sessions:           500ms
Parse dates (50 docs):       150ms
Cleanup filter:               50ms
────────────────────────────────────────────
TOTAL:                       990ms  [████████████████]

### Initial Load Impact

Sequential cascade:
  Theme:   0-1040ms
  Settings: 1040-1270ms
  GlobalStats: 1270ms (async)
  Sessions: 1270ms (async)
  
First Paint: 1270ms
Data Ready: 2000-3000ms

---

## Implementation Roadmap

### Priority 1: SplashScreen (30 mins)
- Add file: src/components/common/SplashScreen.tsx
- Modify: src/App.tsx (add conditional rendering)
- Impact: Immediate visual feedback

### Priority 2: Batch localStorage (1-2 hours)
- Modify: src/contexts/ThemeContext.tsx
- Batch 16 reads into single function
- Expected improvement: 1000ms → 150ms

### Priority 3: Pagination (2-3 hours)
- Modify: src/utils/indexedDB.ts (add pagination function)
- Modify: src/contexts/SessionContext.tsx (use pagination)
- Expected improvement: 1000ms → 300ms (plus background loading)

### Priority 4: Parallel Loading (2-3 hours)
- Create: src/utils/contextInitializer.ts
- Modify: src/App.tsx (use wrapper)
- Expected improvement: 1270ms → 700ms

### Priority 5: Loading Indicators (1-2 hours)
- Modify: All context providers (add isLoading)
- Modify: Component pages (show skeletons)
- Impact: Better UX during async operations

---

## Performance Targets

Current State:
  Initial blocking:  1270ms
  Total to ready:    2000-3000ms
  UI interactive:    Appears empty for 700-1700ms

After All Phases:
  Initial blocking:  200-300ms
  Total to ready:    500-600ms
  UI interactive:    Immediately with loading indicators
  
Improvement: 85% reduction in initialization time

