## Problem Description

**Type:** Enhancement (UX Polish)
**Priority:** Medium
**Likelihood:** 40%
**Impact:** Unprofessional flicker/flash on startup
**Timeline:** **ALREADY HAPPENING** - visible on every launch

Main window is visible immediately on creation, showing black background before React loads.

### Affected Files

- [`electron/main.ts:365-395`](electron/main.ts#L365-L395) - Window creation without ready-to-show

### Current Implementation

```typescript
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a', // Dark gray
    webPreferences: REQUIRED_SECURITY_SETTINGS,
    // ❌ NO show: false option!
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173'); // Shows immediately!
  } else {
    mainWindow.loadFile(join(__dirname, '../index.html'));
  }

  // ❌ NO ready-to-show event handler!
}
```

### Comparison: Comparison Window (Correct Pattern)

Located at `electron/main.ts:657-693`:

```typescript
const comparisonWindow = new BrowserWindow({
  // ...
  show: false, // Hidden initially!
  backgroundColor: '#ffffff',
});

comparisonWindow.loadURL(/*...*/);

// Show only when ready!
comparisonWindow.once('ready-to-show', () => {
  comparisonWindow.show();
});
```

## User Experience Impact

**Current Behavior:**

- 0ms: User clicks app icon
- 50ms: Electron window appears (black screen)
- 1500ms: React finally renders UI
- **User sees:** 1.5 seconds of black screen

**Expected with Fix:**

- 0ms: User clicks app icon
- 0ms: Window created but hidden
- 1500ms: All providers initialized, React ready
- 1500ms: Window shows (smooth fade-in)
- **User sees:** Nothing until app is fully loaded

## Root Cause

1. `show: false` not set in BrowserWindowOptions
2. No `ready-to-show` event listener
3. No loading splash screen

## Proposed Solution

**Option 1: Hide until ready (Recommended)**

```typescript
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    show: false, // Hide initially
    webPreferences: REQUIRED_SECURITY_SETTINGS,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../index.html'));
  }

  // Show when content is ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();

    // Optional: Fade in effect
    mainWindow?.setOpacity(0);
    let opacity = 0;
    const fadeIn = setInterval(() => {
      opacity += 0.1;
      mainWindow?.setOpacity(opacity);
      if (opacity >= 1) clearInterval(fadeIn);
    }, 20); // 200ms total fade
  });
}
```

## Acceptance Criteria

- [ ] Window hidden until `ready-to-show` event fires
- [ ] No black screen visible during startup
- [ ] Smooth appearance of UI (optional: fade-in effect)
- [ ] Dev tools open correctly in development mode
- [ ] Window shows at correct size and position
- [ ] All window event handlers still work correctly

## Testing Strategy

1. **Cold Start Test:** Restart app 10 times, verify no black screen flicker
2. **Dev Mode Test:** Run `npm run dev`, verify dev tools open correctly
3. **Production Test:** Build app, test on fresh install and with existing data

## Estimated Effort

**30 minutes** (15 min implementation + 15 min testing)

## Priority Justification

**Why Medium (not High):**

- Purely cosmetic issue (doesn't affect functionality)
- Workaround exists (users can wait)
- Easy fix, low risk

**Why Not Low:**

- Affects every single app launch
- First impression matters (UX quality)
- Simple fix with big perceived improvement

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#medium-priority-issue-6-main-window-shows-black-screen-on-startup)
