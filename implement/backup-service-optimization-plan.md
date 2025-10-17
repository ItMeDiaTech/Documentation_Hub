# BackupService Electron Architecture Optimization

**Session Started:** 2025-10-17
**Source:** Senior Developer Analysis + OOXML_HYPERLINK_ARCHITECTURE.md patterns
**Objective:** Move BackupService from renderer to main process following Electron security best practices

---

## Problem Analysis

### Current Issue

```
chunk-PR4QN5HX.js?v=07eb8432:11 Uncaught Error: Dynamic require of "path" is not supported
    at chunk-PR4QN5HX.js?v=07eb8432:11:9
    at path.js?v=07eb8432:7:11
```

### Root Cause

- `BackupService.ts` located in `src/services/document/` (renderer code)
- Uses `window.require('path')`, `window.require('fs')`, `window.require('os')`
- Vite tries to bundle Node.js modules for browser → FAILS
- Violates Electron context isolation architecture

### Why This Violates Architecture

1. **Security**: Renderer should NOT have direct Node.js access
2. **Context Isolation**: Main/Renderer separation enforced by modern Electron
3. **Build Process**: Vite cannot bundle Node.js built-ins for browser
4. **Best Practice**: File operations belong in main process

---

## Source Analysis

### Current BackupService (Renderer)

**Location:** `src/services/document/BackupService.ts`
**Size:** 385 lines
**Methods:** 13 public + 4 private
**Dependencies:**

- `crypto` (createHash)
- `path` (via window.require)
- `fs` (via window.require)
- `os` (via window.require)
- `@/utils/logger`

### Current Usage Points

Found via `grep -r "BackupService"`:

- `src/services/document/DocumentProcessor.ts` - Import and usage
- Potentially used in session contexts

### Existing IPC Patterns

**Reference:** `electron/preload.ts`

- Already has `restoreFromBackup` IPC handler
- Pattern: `ipcRenderer.invoke('handler-name', args)`
- Follows secure contextBridge exposure

---

## Target Integration

### New Architecture Pattern

```
┌─────────────────────────────────────────────────────────┐
│ RENDERER PROCESS (Browser/React)                        │
│                                                          │
│  SessionContext.tsx / DocumentProcessor.tsx             │
│  └─> window.electronAPI.backup.create(path)            │
│                          ↓                               │
│                     IPC Bridge                           │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ PRELOAD SCRIPT (Secure Bridge)                          │
│                                                          │
│  electron/preload.ts                                    │
│  └─> ipcRenderer.invoke('backup:create', path)         │
│                          ↓                               │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ MAIN PROCESS (Full Node.js Access)                      │
│                                                          │
│  electron/main.ts                                       │
│  └─> ipcMain.handle('backup:create', handler)          │
│                          ↓                               │
│  electron/services/BackupService.ts                     │
│  └─> Native fs, path, os, crypto modules               │
└─────────────────────────────────────────────────────────┘
```

### Integration Points

1. **New Directory:** `electron/services/` (create if not exists)
2. **Modified Files:**
   - `electron/services/BackupService.ts` (move + refactor)
   - `electron/main.ts` (add IPC handlers)
   - `electron/preload.ts` (expose backup API)
   - `src/services/document/DocumentProcessor.ts` (update usage)
   - Any contexts/components using BackupService

### Pattern Matching (From OOXML Docs)

Following established patterns:

- **Logger Integration:** Like `src/utils/logger.ts:40` uses `import * as path`
- **Main Process Services:** Similar to existing hyperlink handlers
- **IPC Security:** Matches `preload.ts` contextBridge patterns
- **Error Handling:** Consistent with existing service patterns

---

## Implementation Tasks

### Phase 1: Setup & Analysis ✅

- [x] Analyze current BackupService implementation
- [x] Identify all usage points in codebase
- [x] Review existing IPC patterns in preload.ts
- [x] Create implementation plan
- [ ] Create `electron/services/` directory

### Phase 2: Service Migration

- [ ] Create `electron/services/BackupService.ts`
- [ ] Refactor to use native Node.js imports (no window.require)
- [ ] Update logger import for main process
- [ ] Add comprehensive JSDoc comments
- [ ] Preserve all existing functionality

### Phase 3: IPC Handler Implementation

- [ ] Add IPC handlers in `electron/main.ts`:
  - `backup:create` - Create document backup
  - `backup:restore` - Restore from backup
  - `backup:list` - List backups for document
  - `backup:delete` - Delete specific backup
  - `backup:cleanup` - Cleanup old backups
  - `backup:verify` - Verify backup integrity
  - `backup:storage-info` - Get storage statistics
  - `backup:set-config` - Update backup configuration
- [ ] Add error handling and validation
- [ ] Add request logging for debugging

### Phase 4: Preload API Exposure

- [ ] Update `electron/preload.ts` with backup API:
  ```typescript
  backup: {
    create: (path: string) => Promise<string>,
    restore: (backupPath: string, targetPath: string) => Promise<void>,
    list: (documentPath: string) => Promise<BackupInfo[]>,
    delete: (backupPath: string) => Promise<void>,
    cleanup: (documentPath: string) => Promise<number>,
    verify: (backupPath: string) => Promise<boolean>,
    getStorageInfo: () => Promise<StorageInfo>,
    setConfig: (config: BackupConfig) => Promise<void>,
  }
  ```
- [ ] Add TypeScript type definitions
- [ ] Update global Window interface

### Phase 5: Renderer Code Updates

- [ ] Remove `src/services/document/BackupService.ts` (old renderer version)
- [ ] Update `DocumentProcessor.ts` to use IPC API
- [ ] Update any other usage points found
- [ ] Add error handling for IPC failures
- [ ] Create utility wrapper if needed for cleaner usage

### Phase 6: Type Definitions

- [ ] Create `src/types/backup.ts` for shared types:
  - `BackupInfo` interface
  - `BackupMetadata` interface
  - `StorageInfo` interface
  - `BackupConfig` interface
- [ ] Export from preload for type safety
- [ ] Update ElectronAPI type definition

### Phase 7: Documentation

- [ ] Update `electron/CLAUDE.md` with new backup IPC handlers
- [ ] Update `src/services/document/CLAUDE.md` to remove BackupService
- [ ] Add inline code documentation
- [ ] Update architecture diagrams if needed

### Phase 8: Testing & Validation

- [ ] Test backup creation via IPC
- [ ] Test backup restoration
- [ ] Test list backups functionality
- [ ] Test cleanup operations
- [ ] Verify error handling
- [ ] Test configuration updates
- [ ] Verify no Vite build errors
- [ ] Run TypeScript type checking
- [ ] Test in dev mode
- [ ] Test in production build

---

## Validation Checklist

### Build Validation

- [ ] TypeScript compiles without errors
- [ ] Vite dev server starts without errors
- [ ] Production build succeeds
- [ ] No "Dynamic require" errors
- [ ] Electron app launches successfully

### Functional Validation

- [ ] Backup creation works
- [ ] Backup restoration works
- [ ] Backup listing returns correct data
- [ ] Backup deletion works
- [ ] Cleanup removes old backups
- [ ] Integrity verification works
- [ ] Storage info returns accurate data
- [ ] Configuration updates persist

### Security Validation

- [ ] No Node.js APIs exposed in renderer
- [ ] Context isolation maintained
- [ ] IPC handlers validate inputs
- [ ] File paths sanitized and validated
- [ ] No arbitrary file access possible

### Integration Validation

- [ ] Document processing still creates backups
- [ ] Session context backup calls work
- [ ] No regression in existing functionality
- [ ] Performance acceptable (IPC overhead ~1-5ms)

---

## Code Transformation Examples

### Before (Renderer - BROKEN)

```typescript
// src/services/document/BackupService.ts
constructor() {
  const path = window.require('path');  // ❌ Fails in Vite
  const os = window.require('os');
  this.backupDir = path.join(os.homedir(), '.dochub', 'backups');
}

async createBackup(documentPath: string): Promise<string> {
  const fs = window.require('fs').promises;  // ❌ Fails in Vite
  const documentData = await fs.readFile(documentPath);
  // ...
}
```

### After (Main Process - WORKING)

```typescript
// electron/services/BackupService.ts
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { createHash } from 'crypto';

constructor() {
  // ✅ Direct Node.js access in main process
  this.backupDir = path.join(os.homedir(), '.dochub', 'backups');
}

async createBackup(documentPath: string): Promise<string> {
  // ✅ Native fs access
  const documentData = await fs.readFile(documentPath);
  // ...
}
```

### IPC Handler (Main Process)

```typescript
// electron/main.ts
import { BackupService } from './services/BackupService';

const backupService = new BackupService();

ipcMain.handle('backup:create', async (event, documentPath: string) => {
  try {
    return await backupService.createBackup(documentPath);
  } catch (error) {
    console.error('Backup creation failed:', error);
    throw error;
  }
});
```

### Renderer Usage (After)

```typescript
// src/services/document/DocumentProcessor.ts
async createBackup(documentPath: string): Promise<string> {
  // ✅ Uses IPC instead of direct file access
  return await window.electronAPI.backup.create(documentPath);
}
```

---

## Performance Implications

### IPC Overhead

- **IPC Call Time:** ~1-5ms per operation
- **File I/O Time:** 10-100ms (unchanged)
- **Total Impact:** <5% overhead (negligible)

### Benefits

- **Security:** Proper context isolation
- **Maintainability:** Clear separation of concerns
- **Scalability:** Can add background processing
- **Build Performance:** Vite no longer tries to bundle Node.js modules

---

## Risk Mitigation

### Potential Issues

1. **Breaking Changes:** Existing code calls BackupService directly
   - **Mitigation:** Update all usage points systematically
   - **Rollback:** Git checkpoint before each phase

2. **Type Safety:** Async IPC calls need proper typing
   - **Mitigation:** Comprehensive TypeScript definitions
   - **Validation:** Type checking after each change

3. **Error Handling:** IPC errors different from direct calls
   - **Mitigation:** Wrap IPC calls with try/catch
   - **Testing:** Test error scenarios explicitly

### Rollback Strategy

```bash
# If issues occur, revert in order:
git checkout HEAD -- electron/services/
git checkout HEAD -- electron/main.ts
git checkout HEAD -- electron/preload.ts
git checkout HEAD -- src/services/document/DocumentProcessor.ts
npm run dev  # Test rollback works
```

---

## Success Criteria

### Must Have

- ✅ No "Dynamic require" errors in browser console
- ✅ All backup operations functional via IPC
- ✅ TypeScript compilation successful
- ✅ Dev and production builds work
- ✅ Context isolation maintained

### Should Have

- ✅ Comprehensive error handling
- ✅ Type-safe IPC calls
- ✅ Updated documentation
- ✅ No performance regression
- ✅ Clean code following project patterns

### Nice to Have

- ✅ Background backup operations
- ✅ Progress tracking for large backups
- ✅ Cancellation support
- ✅ Backup scheduling capabilities

---

## Next Steps

1. ✅ Create implementation plan (this document)
2. ⏳ Create `electron/services/` directory
3. ⏳ Migrate BackupService to main process
4. ⏳ Implement IPC handlers
5. ⏳ Update renderer code
6. ⏳ Test thoroughly
7. ⏳ Update documentation

---

**Estimated Total Time:** 45 minutes
**Current Progress:** 12% (analysis complete, plan created)
**Risk Level:** Low (well-defined Electron pattern)
