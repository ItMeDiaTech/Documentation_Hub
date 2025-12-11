# Implementing delta updates in Electron with electron-builder and electron-updater

Delta updates work out-of-the-box with your stack—**blockmap files are generated automatically** for NSIS targets, and electron-updater uses them by default. The key is ensuring proper configuration for auto-restart and handling your corporate network scenario. Here's everything you need for a complete implementation.

## How blockmap-based delta updates work

When electron-builder creates an NSIS installer, it automatically generates a `.blockmap` file alongside the `.exe`. This file contains checksums of content-defined chunks created using a rolling hash algorithm. During updates, electron-updater downloads both the old and new blockmap files, compares them, and only downloads the changed blocks via HTTP Range requests. A typical update might show: **"Full: 66,133 KB, To download: 7,785 KB (12%)"**—demonstrating significant bandwidth savings.

Three files are generated for each build: the installer (`App Setup 1.0.0.exe`), its blockmap (`App Setup 1.0.0.exe.blockmap`), and the metadata file (`latest.yml`). All three must be published to GitHub Releases for delta updates to function.

## Package.json build configuration

No special configuration is required to enable delta updates—they're on by default. However, your `artifactName` must include the version to ensure proper blockmap URL construction:

```json
{
  "name": "your-app",
  "version": "1.0.0",
  "build": {
    "appId": "com.yourcompany.app",
    "productName": "Your App",
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "artifactName": "${productName} Setup ${version}.${ext}",
      "deleteAppDataOnUninstall": false
    },
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "your-repo",
      "releaseType": "release"
    }
  },
  "dependencies": {
    "electron-updater": "^6.7.2",
    "electron-log": "^5.0.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^26.3.0"
  }
}
```

To explicitly disable delta updates (if needed), add `"differentialPackage": false` under the `nsis` key, or set `autoUpdater.disableDifferentialDownload = true` at runtime.

## Complete auto-update implementation with silent restart

Here's a production-ready implementation that handles your Zscaler/corporate network scenario with automatic silent restart:

```typescript
// updater.ts
import { NsisUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { app, session, BrowserWindow } from 'electron';
import log from 'electron-log';

export class AutoUpdateManager {
  private autoUpdater: NsisUpdater;
  private mainWindow: BrowserWindow | null = null;

  constructor(mainWindow?: BrowserWindow) {
    this.mainWindow = mainWindow || null;
    
    // Use NsisUpdater directly for custom configuration
    this.autoUpdater = new NsisUpdater({
      provider: 'github',
      owner: 'your-username',
      repo: 'your-repo'
    });

    this.configureUpdater();
    this.setupCorporateNetworkHandling();
    this.setupEventHandlers();
  }

  private configureUpdater(): void {
    // Attach logger for debugging
    this.autoUpdater.logger = log;
    log.transports.file.level = 'debug';

    // Core configuration
    this.autoUpdater.autoDownload = true;           // Auto-download when found
    this.autoUpdater.autoInstallOnAppQuit = true;   // Install on quit as fallback
    this.autoUpdater.autoRunAppAfterInstall = true; // Restart after install
    
    // Keep differential downloads enabled (default)
    this.autoUpdater.disableDifferentialDownload = false;
  }

  private setupCorporateNetworkHandling(): void {
    // Handle Zscaler/corporate proxy certificate interception
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      const { hostname, certificate, verificationResult } = request;
      
      log.debug('Certificate verification:', {
        hostname,
        issuer: certificate.issuerName,
        result: verificationResult
      });

      // Accept known corporate CA certificates (Zscaler, etc.)
      const trustedIssuers = ['Zscaler', 'YourCorpCA'];
      const isTrustedCorporate = trustedIssuers.some(
        issuer => certificate.issuerName.includes(issuer)
      );

      if (verificationResult === 'net::OK' || isTrustedCorporate) {
        callback(0); // Accept
      } else {
        log.warn('Rejecting untrusted certificate:', certificate.issuerName);
        callback(-2); // Reject
      }
    });
  }

  private setupEventHandlers(): void {
    this.autoUpdater.on('checking-for-update', () => {
      log.info('Checking for update...');
      this.sendStatusToRenderer('checking');
    });

    this.autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info(`Update available: ${info.version}`);
      this.sendStatusToRenderer('available', info);
    });

    this.autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      log.info('Application is up to date');
      this.sendStatusToRenderer('not-available', info);
    });

    this.autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      const message = `Downloaded ${progress.percent.toFixed(1)}% (${this.formatBytes(progress.transferred)}/${this.formatBytes(progress.total)})`;
      log.info(message);
      this.sendStatusToRenderer('downloading', progress);
    });

    this.autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info(`Update downloaded: ${info.version}`);
      this.sendStatusToRenderer('downloaded', info);
      
      // Trigger silent automatic restart
      this.installAndRestart();
    });

    this.autoUpdater.on('error', (error: Error) => {
      log.error('Auto-updater error:', error);
      this.sendStatusToRenderer('error', { message: error.message });
    });
  }

  private installAndRestart(): void {
    log.info('Installing update and restarting...');
    
    setImmediate(() => {
      // Remove listeners that might prevent quit
      app.removeAllListeners('window-all-closed');
      
      // quitAndInstall(isSilent, isForceRunAfter)
      // isSilent=true: No installer UI shown
      // isForceRunAfter=true: App restarts after silent install
      this.autoUpdater.quitAndInstall(true, true);
    });
  }

  private sendStatusToRenderer(status: string, data?: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-status', { status, data });
    }
  }

  private formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  public async checkForUpdates(): Promise<void> {
    // Skip check on first run (Squirrel issue)
    if (process.argv.includes('--squirrel-firstrun')) {
      log.info('Skipping update check on first run');
      return;
    }

    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      log.error('Update check failed:', error);
    }
  }

  public startScheduledChecks(intervalMs: number = 4 * 60 * 60 * 1000): void {
    // Check every 4 hours by default
    setInterval(() => this.checkForUpdates(), intervalMs);
  }
}
```

## Main process integration

```typescript
// main.ts
import { app, BrowserWindow } from 'electron';
import { AutoUpdateManager } from './updater';

let mainWindow: BrowserWindow | null = null;
let updateManager: AutoUpdateManager;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Initialize updater after window is ready
  updateManager = new AutoUpdateManager(mainWindow);
  
  // Delay initial check to avoid startup conflicts
  setTimeout(() => {
    updateManager.checkForUpdates();
  }, 10000);

  // Start periodic checks
  updateManager.startScheduledChecks();
});
```

## Testing delta updates locally

Create a `dev-app-update.yml` file in your project root to test updates against a local server:

```yaml
provider: generic
url: http://localhost:8080/updates/
channel: latest
```

Set up a simple local update server:

```javascript
// local-server.js
const express = require('express');
const path = require('path');
const app = express();

// Enable range requests for differential downloads
app.use('/updates', express.static(path.join(__dirname, 'dist'), {
  acceptRanges: true
}));

app.listen(8080, () => console.log('Update server: http://localhost:8080'));
```

Modify your updater to use the dev config during development:

```typescript
import path from 'path';

// In your updater constructor, add:
if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
  this.autoUpdater.forceDevUpdateConfig = true;
  this.autoUpdater.updateConfigPath = path.join(__dirname, '../dev-app-update.yml');
}
```

**Testing workflow:**
1. Build version 1.0.0: `npm run build`
2. Copy dist files to your server directory
3. Install and run version 1.0.0
4. Bump version to 1.0.1 and rebuild
5. Copy new dist files (including `.blockmap`) to server
6. The running app should detect and delta-download the update

## Verifying differential downloads actually work

Enable debug logging and look for these key log entries that confirm delta updates:

```
[info] Download block maps (old: ".../1.0.0.exe.blockmap", new: ".../1.0.1.exe.blockmap")
[info] File has 367 changed blocks
[info] Full: 113,665.86 KB, To download: 7,785.66 KB (7%)
```

If you see **"Cannot download differentially, fallback to full download"**, check that:
- Both `.blockmap` files are accessible (current and new version)
- Your server supports HTTP Range requests
- The SHA512 checksums in `latest.yml` match the actual files
- The updater cache isn't corrupted (clear `%AppData%\Local\{app-name}-updater`)

## Troubleshooting common issues

**Blockmap 404 errors on GitHub**: Ensure you publish both the `.exe` and `.exe.blockmap` files to the same release. When using `electron-builder --publish always`, this happens automatically.

**Certificate errors behind Zscaler**: The `setCertificateVerifyProc` handler in the implementation above addresses this. Add your corporate CA's issuer name to the `trustedIssuers` array.

**Silent install not restarting**: The `quitAndInstall(true, true)` call with both parameters set to `true` forces silent install with auto-restart. Ensure `app.removeAllListeners('window-all-closed')` is called before `quitAndInstall` to prevent quit interruption.

**First-run update check fails**: Windows Squirrel holds a file lock during initial installation. Always check for `--squirrel-firstrun` in process arguments and skip the update check on first launch, as shown in the implementation.

## Conclusion

The electron-builder + electron-updater stack provides robust delta update support with minimal configuration. Key takeaways: blockmaps are generated automatically for NSIS targets, `quitAndInstall(true, true)` enables silent auto-restart on Windows, and corporate proxy scenarios require explicit certificate handling via `setCertificateVerifyProc`. For local testing, combine `dev-app-update.yml` with `forceDevUpdateConfig = true` and a local HTTP server with range request support. Monitor your logs for the "changed blocks" message to confirm differential downloads are working—you should see download sizes of **5-20% of the full installer** for typical application updates.