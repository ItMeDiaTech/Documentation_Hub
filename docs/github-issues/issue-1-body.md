## Problem Description

**Type:** Bug (Race Condition)
**Priority:** Critical
**Likelihood:** 95%
**Impact:** App initialization failures, null reference errors
**Timeline:** **ALREADY HAPPENING** - affects every cold start

Three separate `app.whenReady()` handlers run in parallel with no guaranteed execution order, causing:

- Null reference errors when AutoUpdaterHandler tries to access `mainWindow` before it's created
- Network failures when window loads before proxy configuration completes
- Certificate validation running in background with arbitrary delays

### Affected Files

- [`electron/main.ts:194-261`](electron/main.ts#L194-L261) - Proxy configuration
- [`electron/main.ts:572-608`](electron/main.ts#L572-L608) - Window creation + certificate check
- [`electron/main.ts:1585-1595`](electron/main.ts#L1585-L1595) - Auto-updater initialization

### Code Example

**Current (Problematic):**

```typescript
// THREE separate handlers running in parallel!
app.whenReady().then(async () => {
  await proxyConfig.configureSessionProxy(); // Location 1
});

app.whenReady().then(async () => {
  await createWindow(); // Location 2
  setImmediate(() => {
    await new Promise((resolve) => setTimeout(resolve, 500)); // Arbitrary delay!
    performPreflightCertificateCheck();
  });
});

app.whenReady().then(() => {
  setTimeout(() => {
    updaterHandler = new AutoUpdaterHandler(); // mainWindow might be null!
  }, 1000); // Another arbitrary delay!
});
```

## Root Cause

1. No execution order guarantee between handlers
2. `mainWindow` may be `null` when updater initializes (line 1494)
3. Proxy configuration might not complete before window loads
4. Artificial delays (500ms, 1000ms) are fragile timing assumptions

## Impact on Users

- Black screen on startup (window creates before proxy config)
- Auto-update fails with network errors
- Occasional crashes: "Cannot read property of null"

## Proposed Solution

Consolidate into single, sequential initialization flow:

```typescript
app.whenReady().then(async () => {
  log.info('Starting DocumentHub initialization...');

  try {
    // STEP 1: Configure network infrastructure (BLOCKING)
    log.info('[1/4] Configuring proxy and network...');
    await proxyConfig.configureSessionProxy();

    // STEP 2: Validate certificates (BLOCKING if critical)
    log.info('[2/4] Validating certificates...');
    await performPreflightCertificateCheck();

    // STEP 3: Create main window (BLOCKING)
    log.info('[3/4] Creating main window...');
    await createWindow();

    // STEP 4: Initialize background services (NON-BLOCKING)
    log.info('[4/4] Starting background services...');
    setImmediate(() => {
      if (!mainWindow) {
        log.error('Main window is null during updater initialization!');
        return;
      }

      updaterHandler = new AutoUpdaterHandler(mainWindow);
      if (!isDev) {
        updaterHandler.checkOnStartup();
      }

      log.info('DocumentHub initialization complete');
    });
  } catch (error) {
    log.error('Failed to initialize DocumentHub:', error);
    app.quit();
  }
});
```

## Acceptance Criteria

- [ ] Only ONE `app.whenReady()` handler exists
- [ ] Proxy configuration completes BEFORE window creation
- [ ] Certificate validation completes BEFORE network requests
- [ ] `mainWindow` is guaranteed non-null when AutoUpdaterHandler initializes
- [ ] No artificial setTimeout delays (use actual completion signals)
- [ ] All initialization steps logged with clear status messages
- [ ] App quits gracefully if critical initialization fails

## Testing Strategy

1. **Cold Start Test:** Restart app 10 times, verify no errors in logs
2. **Network Timing Test:** Add 2s latency to proxy config, verify app waits
3. **Certificate Failure Test:** Block GitHub, verify app handles gracefully
4. **Updater Test:** Verify updater only initializes after window exists

## Estimated Effort

**2 hours** (1 hour implementation + 1 hour testing)

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#critical-issue-1-multiple-appwhenready-race-condition)
