## Problem Description

**Type:** Bug (Timing/Coordination)
**Priority:** Medium
**Likelihood:** 50%
**Impact:** Auto-update delayed by 5-10 seconds in corporate environments
**Timeline:** **ALREADY HAPPENING** - affects users behind proxies

Background certificate check and auto-updater initialize independently with no coordination, causing TLS failures when updater runs before certificates are validated.

### Affected Files

- [`electron/main.ts:576-607`](electron/main.ts#L576-L607) - Certificate check (runs at 500ms)
- [`electron/main.ts:1585-1595`](electron/main.ts#L1585-L1595) - Auto-updater (runs at 1000ms)

### Current Implementation

**Certificate Check:**

```typescript
app.whenReady().then(async () => {
  await createWindow();

  setImmediate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500)); // ❌ Arbitrary delay

    performPreflightCertificateCheck()
      .then(() => {
        // ... success handling
      })
      .catch((error) => {
        // ... error handling
      });
  });
});
```

**Auto-Updater:**

```typescript
app.whenReady().then(() => {
  setTimeout(() => {
    updaterHandler = new AutoUpdaterHandler(); // ❌ Might run before certs validated!

    if (!isDev) {
      updaterHandler.checkOnStartup(); // Immediately tries to connect
    }
  }, 1000); // ❌ Another arbitrary delay
});
```

## The Race Condition

**Scenario 1: Certificate check wins (500ms < 1000ms)**

- Result: Works correctly

**Scenario 2: Certificate check is slow (network latency)**

- 500ms: Certificate check starts
- 1000ms: Auto-updater starts
- 1001ms: Update check fails with TLS error (certs not ready)
- 2000ms: Certificate check completes (too late!)
- Result: Auto-update fails, user doesn't get notified

**Scenario 3: Corporate proxy (high latency)**

- Both checks hang waiting for proxy auth
- Both timeout
- Result: Both fail, no updates available

## Impact Analysis

**Affected Users:**

- Corporate environments with Zscaler/proxy
- Users with slow network connections
- Users with SSL-intercepting firewalls

Based on extensive proxy configuration code (lines 51-313), this clearly affects a significant portion of users.

**User Experience:**

- Update notification should appear
- Instead: silence (update check failed)
- User never knows update is available
- Continues using old version with bugs

## Root Cause

1. **Independent Initialization:** Two `setTimeout` calls with arbitrary delays (500ms, 1000ms)
2. **No Synchronization:** Auto-updater doesn't wait for certificate validation
3. **Race Condition:** Which finishes first is unpredictable (network dependent)
4. **Silent Failure:** Failed update checks don't retry or notify user

## Proposed Solution

Make certificate validation a prerequisite for updater:

```typescript
app.whenReady().then(async () => {
  // STEP 1: Create window first (user sees app immediately)
  await createWindow();

  // STEP 2: Background initialization (non-blocking for UI)
  setImmediate(async () => {
    try {
      // STEP 2A: Validate certificates (BLOCKING for updater)
      log.info('[Init] Validating certificates...');
      await performPreflightCertificateCheck();
      log.info('[Init] Certificates validated');

      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('certificate-check-complete', {
          success: true,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      log.error('[Init] Certificate validation failed:', error);

      // Notify renderer of failure
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('certificate-check-complete', {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // STEP 2B: Initialize updater (AFTER certificates validated)
    log.info('[Init] Initializing auto-updater...');
    updaterHandler = new AutoUpdaterHandler(mainWindow);

    if (!isDev) {
      setTimeout(() => {
        log.info('[Init] Checking for updates...');
        updaterHandler.checkOnStartup();
      }, 2000); // 2 second delay AFTER certs validated
    }

    log.info('[Init] Background initialization complete');
  });
});
```

## Acceptance Criteria

- [ ] Auto-updater only initializes AFTER certificate validation completes
- [ ] No race condition between certificate check and update check
- [ ] Failed certificate validation delays updater (doesn't crash it)
- [ ] Update checks succeed in corporate proxy environments
- [ ] User gets notified of available updates within 5 seconds
- [ ] Failed update checks retry with exponential backoff

## Testing Strategy

1. **Normal Network Test:** Verify update notification appears within 5 seconds
2. **Slow Network Test:** Add 3s latency, verify updater waits for certificates
3. **Corporate Proxy Test:** Test with Zscaler/proxy configuration
4. **Certificate Failure Test:** Block GitHub certificates, verify updater doesn't crash

## Estimated Effort

**1 hour** (30 min implementation + 30 min testing)

## Research Reference

Full analysis: [`GH_Issues/scratchpads/predictive-analysis-2025-10-18.md`](../GH_Issues/scratchpads/predictive-analysis-2025-10-18.md#medium-priority-issue-7-certificate-check-delays-auto-update)
