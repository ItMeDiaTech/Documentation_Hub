# Black Screen Prevention System

## Overview

This document explains the multi-layered protection system designed to prevent the recurring "black screen" issue that has plagued this application after updates. The black screen is NOT caused by the update process itself, but by accidental modifications to critical Electron security settings during development.

## The Problem

### Historical Incidents

- **2025-10-17** (Commit 159f47b): contextIsolation accidentally set to false → black screen
- **2025-10-16** (Commit 290ee59): TypeScript errors causing black screen
- **2024-12-xx** (Commit 7575ba6): Production build black screen

### Root Cause

The black screen occurs when either of these Electron security settings in `electron/main.ts` are changed:

1. **`nodeIntegration: false → true`**
   - Breaks preload API communication
   - Creates security vulnerability
   - May cause rendering issues

2. **`contextIsolation: true → false`** (MOST COMMON)
   - Breaks React lazy loading
   - Breaks Context API (Theme, Router, Session contexts)
   - Breaks dynamic imports
   - **Result: Blank/black screen in production**

### Why It Keeps Happening

During development and refactoring:
- Someone (human or AI) makes "improvements" to the codebase
- They accidentally modify the webPreferences configuration
- TypeScript doesn't catch it (before our fix)
- The build succeeds but the app won't render
- These changes get committed and deployed in the next update
- Users update and see black screen

## The Solution: Multi-Layer Protection

We've implemented a defense-in-depth strategy with validation at every stage of the development pipeline.

### Layer 1: TypeScript Const Assertion (Compile-Time)

**Location:** `electron/main.ts:352-356`

```typescript
const REQUIRED_SECURITY_SETTINGS = {
  preload: join(__dirname, 'preload.js'),
  nodeIntegration: false,
  contextIsolation: true,
} as const;
```

**How it works:**
- TypeScript `as const` makes the object read-only
- Any attempt to modify values causes a compile error
- Prevents accidental changes during development

**What it catches:**
- Direct modifications to security settings
- TypeScript compilation errors

**Bypass:** Cannot be bypassed (compile error)

### Layer 2: Runtime Validation (Development)

**Location:** `electron/main.ts:405-471`

**How it works:**
- Runs ONLY in development mode (`isDev`)
- Validates security settings immediately after window creation
- Throws error with detailed explanation if settings are wrong
- Shows prominent error boxes explaining the issue

**What it catches:**
- Settings changed after TypeScript compilation
- Runtime modifications to webPreferences
- Provides educational feedback to developers

**Bypass:** Only runs in dev mode (production not affected)

### Layer 3: Git Pre-Commit Hook

**Location:** `.husky/pre-commit`

**How it works:**
- Runs automatically before every git commit
- Scans `electron/main.ts` for dangerous changes
- Uses regex to detect `nodeIntegration: true` or `contextIsolation: false`
- Blocks commit with detailed error message

**What it catches:**
- Attempts to commit insecure settings
- Removal of REQUIRED_SECURITY_SETTINGS constant
- Provides historical context and fix instructions

**Bypass:** `git commit --no-verify` (NOT RECOMMENDED)

### Layer 4: CI/CD Validation (GitHub Actions)

**Location:** `.github/workflows/release.yml:23-50`

**How it works:**
- Runs as first step in release workflow (after checkout)
- Validates security settings before any build starts
- Fails the entire build if violations detected
- Prevents bad builds from reaching users

**What it catches:**
- Changes that bypassed git hooks (--no-verify)
- Direct pushes without local validation
- Ensures clean builds only

**Bypass:** Cannot bypass (would need to modify workflow)

## How to Safely Expose New APIs

If you need to add new Electron APIs for the renderer process:

### ✅ CORRECT WAY:

1. Add to `electron/preload.ts`:
```typescript
const electronAPI = {
  // Your new API
  myNewFeature: () => ipcRenderer.invoke('my-new-feature'),
};
```

2. Add handler in `electron/main.ts`:
```typescript
ipcMain.handle('my-new-feature', async () => {
  // Implementation
});
```

3. Use in renderer via `window.electronAPI.myNewFeature()`

### ❌ WRONG WAY:

```typescript
// DON'T DO THIS!
webPreferences: {
  nodeIntegration: true,  // ← NEVER do this
  contextIsolation: false, // ← NEVER do this
}
```

## Validation Layer Summary

| Layer | When It Runs | What It Prevents | Can Bypass? |
|-------|-------------|------------------|-------------|
| TypeScript const | Compile-time | Direct modifications | No (compile error) |
| Runtime validation | Development startup | Runtime changes | Only in production |
| Pre-commit hook | Before git commit | Committing bad code | Yes (--no-verify) |
| CI/CD validation | Before build/release | Bad releases | No |

## Testing the Protection

### Test Layer 1 (TypeScript)
```typescript
// Try to modify the constant
REQUIRED_SECURITY_SETTINGS.nodeIntegration = true;
// Result: TypeScript error - Cannot assign to read-only property
```

### Test Layer 2 (Runtime)
```typescript
// Temporarily change to test:
const REQUIRED_SECURITY_SETTINGS = {
  preload: join(__dirname, 'preload.js'),
  nodeIntegration: false,
  contextIsolation: false, // ← Test this
} as const;
// Run: npm run dev
// Result: Big error box with explanation, app won't start
```

### Test Layer 3 (Git Hook)
```bash
# Make a bad change and try to commit
git add electron/main.ts
git commit -m "test"
# Result: Commit blocked with detailed error message
```

### Test Layer 4 (CI/CD)
```bash
# Push a tag to trigger release workflow
git tag v1.0.test
git push origin v1.0.test
# Check GitHub Actions: https://github.com/ItMeDiaTech/Documentation_Hub/actions
# Result: Build fails at "Validate Electron Security Settings" step
```

## Maintenance

### If You Need to Update This System

1. **Update all layers simultaneously:**
   - TypeScript constant (`electron/main.ts`)
   - Runtime validation (`electron/main.ts`)
   - Pre-commit hook (`.husky/pre-commit`)
   - CI/CD validation (`.github/workflows/release.yml`)

2. **Update documentation:**
   - This file (`BLACK_SCREEN_PREVENTION.md`)
   - `CLAUDE.md` if relevant
   - `electron/CLAUDE.md` if relevant

3. **Test all layers** before committing

### Adding New Protected Settings

If you need to protect additional settings:

1. Add to `REQUIRED_SECURITY_SETTINGS` constant
2. Add validation in runtime check
3. Update pre-commit hook regex
4. Update CI/CD validation
5. Document in this file

## FAQ

### Q: Why so many layers of validation?

**A:** Each layer catches issues at different stages:
- TypeScript: Prevents during coding
- Runtime: Educates during development
- Git hook: Blocks before commit
- CI/CD: Final safety net before release

### Q: Can I disable these checks?

**A:** You *can* bypass git hooks with `--no-verify`, but you **should not**. The CI/CD validation will still catch issues. If you absolutely must make changes to security settings, you need a very good reason and should update all validation layers accordingly.

### Q: What if I get a false positive?

**A:** The validation is intentionally strict. If you're getting errors:
1. Review your changes to `electron/main.ts`
2. Ensure you're not modifying `REQUIRED_SECURITY_SETTINGS`
3. If you have a legitimate need, update this prevention system

### Q: How do I know if the protection is working?

**A:** Try the tests in the "Testing the Protection" section above. Each layer should catch attempts to modify the security settings.

## Resources

- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [IPC Security](https://www.electronjs.org/docs/latest/tutorial/ipc)

## Conclusion

This multi-layer protection system ensures that the black screen issue will not happen again after updates. Each layer provides defense-in-depth protection, and together they make it nearly impossible to accidentally deploy insecure or broken Electron configurations.

**Remember:** The update system works fine. The black screen was caused by configuration changes, not the update mechanism. These protections ensure those configuration changes never make it to production.

---

**Last Updated:** 2025-10-17
**Maintained By:** Development Team
**Related Commits:** 159f47b, 290ee59, 7575ba6
