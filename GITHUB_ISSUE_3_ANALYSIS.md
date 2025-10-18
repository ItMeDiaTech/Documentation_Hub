# GitHub Issue #3 Analysis: GlobalStatsProvider Connection Pool Refactoring

## Executive Summary

**Issue:** GlobalStatsProvider doesn't use IndexedDB connection pool
**Severity:** High - Memory leak risk
**Root Cause:** Direct openDB() calls instead of existing IndexedDBConnectionPool
**Status:** Ready for implementation

## Problem Analysis

### Current Issues

#### 1. Multiple Database Connections

- File: src/contexts/GlobalStatsContext.tsx lines 14, 44, 58
- Direct openDB<GlobalStatsDB>() on each mount
- No connection pooling or sharing
- Potential connection leaks on remount

#### 2. Database in React State (CRITICAL)

- const [db, setDb] = useState()
- Anti-pattern: storing db connection in state
- Causes unnecessary re-renders
- updateStats callback depends on db state [db]
- If db becomes null, updateStats becomes stale

#### 3. Improper Cleanup

- Only closes db on unmount
- No beforeunload handler
- App crash = db connection leak
- Contrast: SessionContext uses proper pool with beforeunload

#### 4. No Connection Sharing

- Two separate databases (DocHubDB vs DocHub_GlobalStats)
- SessionContext already uses correct pool pattern
- Duplicated initialization logic

## Correct Pattern Reference

### SessionContext.tsx (CORRECT)

import { loadSessions, saveSession } from '@/utils/indexedDB';
// Uses connection pool implicitly
// No db in state
// No cleanup code needed (handled by pool)

### indexedDB.ts Pattern (CORRECT)

- IndexedDBConnectionPool class (lines 36-186)
- Singleton instance (lines 188-189)
- beforeunload cleanup (lines 192-196)

## Files Using GlobalStatsProvider

1. src/App.tsx - Provider wrapper
2. src/pages/Dashboard.tsx - READ: getTodayStats()
3. src/pages/Analytics.tsx - WRITE: resetAllStats() (async)
4. src/pages/Settings.tsx - READ: stats
5. src/contexts/SessionContext.tsx - WRITE: updateStats() (async)

All consumers use public hook interface - refactoring transparent to them.

## Proposed Solution

### 1. Create GlobalStatsConnectionPool

Add new class in indexedDB.ts (similar to IndexedDBConnectionPool)

- Database: DocHub_GlobalStats
- Store: stats
- Key: 'global'

### 2. Create Helper Functions

- loadGlobalStats()
- saveGlobalStats()
- resetGlobalStats()

### 3. Refactor GlobalStatsContext

- Remove: import { openDB } from 'idb'
- Remove: const [db, setDb] = useState()
- Replace: useEffect initialization
- Update: updateStats callback (no db dependency)
- Update: resetAllStats callback

### 4. Update Cleanup

- Add globalStatsConnectionPool.close() to beforeunload

## Testing Strategy

### Memory Leak Detection

Monitor indexedDB connections in DevTools:

- Before: Grows with each provider remount
- After: Single connection maintained

### Backward Compatibility

- All consumers use useGlobalStats() hook
- Hook interface remains unchanged
- No breaking changes

## Expected Benefits

1. Memory Efficiency - Single connection vs potentially many
2. Proper Cleanup - Guaranteed via beforeunload
3. Consistency - Same pattern as SessionContext
4. Reliability - Automatic reconnection
5. Performance - Connection pooling overhead eliminated
6. Code Quality - Eliminates db-in-state anti-pattern

## Key Metrics

### Before

- Connections per remount: 1+
- Memory per extra connection: ~2-5MB
- Cleanup on unmount: Partial
- App exit cleanup: Not guaranteed

### After

- Total connections: 1
- Memory for connections: ~2MB (constant)
- Cleanup on unmount: Not needed
- App exit cleanup: Guaranteed
