# GitHub-Based Plugin Marketplace Implementation Plan

## Architecture Overview

A decentralized plugin system using GitHub as the distribution platform, similar to VSCode Marketplace but using GitHub Releases as the CDN.

---

## 1. Plugin Structure & Manifest

### **plugin.json** (Plugin Manifest)
```json
{
  "id": "dochub-pdf-export",
  "name": "PDF Export",
  "version": "1.2.0",
  "author": "DocHub Team",
  "description": "Export processed documents as PDF with custom formatting options",
  "category": "document",
  "repository": "https://github.com/DocHubPlugins/pdf-export",
  "main": "dist/index.js",
  "icon": "icon.png",
  "minAppVersion": "1.0.0",
  "maxAppVersion": "*",
  "permissions": ["filesystem", "document:read", "document:write"],
  "engines": {
    "dochub": ">=1.0.0"
  },
  "scripts": {
    "build": "npm run build",
    "test": "npm run test"
  },
  "devDependencies": {
    "@dochub/plugin-sdk": "^1.0.0"
  }
}
```

### **GitHub Repository Structure**
```
dochub-plugin-pdf-export/
├── src/
│   └── index.ts          # Plugin entry point
├── dist/                 # Built plugin (bundled)
├── plugin.json           # Plugin manifest
├── README.md             # Documentation
├── LICENSE
├── .github/
│   └── workflows/
│       └── release.yml   # Auto-build on tag push
└── package.json
```

---

## 2. Plugin Registry System

### **Central Registry (GitHub Repo)**
Create `DocHub-Plugin-Registry` repository with structure:
```
DocHub-Plugin-Registry/
├── plugins/
│   ├── document/
│   │   ├── pdf-export.json
│   │   └── batch-rename.json
│   ├── ui/
│   │   └── theme-builder.json
│   ├── integration/
│   │   └── cloud-sync.json
│   └── automation/
│       └── advanced-analytics.json
├── verified.json         # List of verified plugin IDs
└── README.md
```

### **Plugin Entry Format** (pdf-export.json)
```json
{
  "id": "dochub-pdf-export",
  "name": "PDF Export",
  "description": "Export processed documents as PDF with custom formatting options",
  "repository": "https://github.com/DocHubPlugins/pdf-export",
  "author": "DocHub Team",
  "category": "document",
  "verified": true,
  "latestVersion": "1.2.0",
  "releaseUrl": "https://github.com/DocHubPlugins/pdf-export/releases/latest",
  "stats": {
    "stars": 234,
    "downloads": 15420,
    "rating": 4.8
  },
  "screenshots": [
    "https://raw.githubusercontent.com/DocHubPlugins/pdf-export/main/screenshots/1.png"
  ]
}
```

---

## 3. Implementation Components

### **A. New Files to Create**

#### **src/types/plugin.ts** - Type Definitions
```typescript
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  repository: string;
  main: string;
  icon?: string;
  minAppVersion: string;
  maxAppVersion: string;
  permissions: PluginPermission[];
  engines: {
    dochub: string;
  };
}

export type PluginCategory = 'document' | 'ui' | 'integration' | 'automation';
export type PluginPermission =
  | 'filesystem'
  | 'network'
  | 'document:read'
  | 'document:write'
  | 'settings:read'
  | 'settings:write';

export interface InstalledPlugin extends PluginManifest {
  isEnabled: boolean;
  installedAt: Date;
  installPath: string;
}

export interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  repository: string;
  author: string;
  category: PluginCategory;
  verified: boolean;
  latestVersion: string;
  releaseUrl: string;
  stats: {
    stars: number;
    downloads: number;
    rating: number;
  };
  screenshots?: string[];
}

export interface PluginInstance {
  manifest: PluginManifest;
  activate(api: DocHubAPI): Promise<void>;
  deactivate(): Promise<void>;
}

export interface DocHubAPI {
  document: DocumentAPI;
  ui: UIApi;
  storage: StorageAPI;
  session: SessionAPI;
}

export interface DocumentAPI {
  getActive(): Document | null;
  process(options: ProcessingOptions): Promise<ProcessingResult>;
  export(format: string, options: any): Promise<Buffer>;
}

export interface UIApi {
  showNotification(message: string, type?: 'info' | 'success' | 'error'): void;
  createPanel(options: PanelOptions): Panel;
  createStatusBarItem(): StatusBarItem;
}

export interface StorageAPI {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SessionAPI {
  getCurrent(): Session | null;
  create(name: string): Session;
  close(id: string): void;
}
```

#### **src/services/PluginService.ts** - Core Plugin Logic
```typescript
import { PluginManifest, PluginRegistryEntry, InstalledPlugin } from '@/types/plugin';
import { promises as fs } from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

export class PluginService {
  private registryUrl = 'https://raw.githubusercontent.com/YourOrg/DocHub-Plugin-Registry/main';
  private pluginsDir: string;

  constructor(pluginsDirectory: string) {
    this.pluginsDir = pluginsDirectory;
  }

  /**
   * Fetch plugin registry from GitHub
   */
  async fetchRegistry(): Promise<PluginRegistryEntry[]> {
    const categories = ['document', 'ui', 'integration', 'automation'];
    const plugins: PluginRegistryEntry[] = [];

    for (const category of categories) {
      const response = await fetch(`${this.registryUrl}/plugins/${category}`);
      const files = await response.json();

      for (const file of files) {
        if (file.name.endsWith('.json')) {
          const pluginResponse = await fetch(file.download_url);
          const plugin = await pluginResponse.json();
          plugins.push(plugin);
        }
      }
    }

    return plugins;
  }

  /**
   * Download plugin from GitHub release
   */
  async downloadPlugin(repositoryUrl: string, version: string = 'latest'): Promise<Buffer> {
    const [owner, repo] = repositoryUrl.replace('https://github.com/', '').split('/');
    const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/${version}`;

    const releaseResponse = await fetch(releaseUrl);
    const release = await releaseResponse.json();

    // Find plugin.zip asset
    const asset = release.assets.find((a: any) => a.name === 'plugin.zip');
    if (!asset) {
      throw new Error('Plugin asset not found in release');
    }

    // Download the asset
    const assetResponse = await fetch(asset.browser_download_url);
    const buffer = await assetResponse.arrayBuffer();

    return Buffer.from(buffer);
  }

  /**
   * Install plugin to local directory
   */
  async installPlugin(repositoryUrl: string, version: string = 'latest'): Promise<PluginManifest> {
    // Download plugin
    const buffer = await this.downloadPlugin(repositoryUrl, version);

    // Extract to temp directory first
    const zip = new AdmZip(buffer);
    const tempDir = path.join(this.pluginsDir, 'temp', `plugin-${Date.now()}`);
    zip.extractAllTo(tempDir, true);

    // Read and validate manifest
    const manifestPath = path.join(tempDir, 'plugin.json');
    const manifestData = await fs.readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestData);

    this.validateManifest(manifest);

    // Move to final location
    const finalDir = path.join(this.pluginsDir, manifest.id);
    await fs.rename(tempDir, finalDir);

    return manifest;
  }

  /**
   * Validate plugin manifest
   */
  private validateManifest(manifest: PluginManifest): void {
    const required = ['id', 'name', 'version', 'author', 'description', 'category', 'main'];
    for (const field of required) {
      if (!manifest[field as keyof PluginManifest]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      throw new Error('Invalid version format');
    }
  }

  /**
   * Load plugin
   */
  async loadPlugin(pluginId: string): Promise<PluginManifest> {
    const pluginDir = path.join(this.pluginsDir, pluginId);
    const manifestPath = path.join(pluginDir, 'plugin.json');

    const manifestData = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(manifestData);
  }

  /**
   * Uninstall plugin
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    const pluginDir = path.join(this.pluginsDir, pluginId);
    await fs.rm(pluginDir, { recursive: true, force: true });
  }

  /**
   * List installed plugins
   */
  async listInstalled(): Promise<InstalledPlugin[]> {
    const plugins: InstalledPlugin[] = [];
    const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'temp') {
        try {
          const manifest = await this.loadPlugin(entry.name);
          const pluginDir = path.join(this.pluginsDir, entry.name);
          const stats = await fs.stat(pluginDir);

          plugins.push({
            ...manifest,
            isEnabled: true, // Load from settings
            installedAt: stats.birthtime,
            installPath: pluginDir,
          });
        } catch (err) {
          console.error(`Failed to load plugin ${entry.name}:`, err);
        }
      }
    }

    return plugins;
  }

  /**
   * Check for updates
   */
  async checkForUpdates(installedPlugins: InstalledPlugin[]): Promise<Array<{
    plugin: InstalledPlugin;
    latestVersion: string;
    hasUpdate: boolean;
  }>> {
    const updates = [];

    for (const plugin of installedPlugins) {
      const [owner, repo] = plugin.repository.replace('https://github.com/', '').split('/');
      const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

      try {
        const response = await fetch(releaseUrl);
        const release = await response.json();
        const latestVersion = release.tag_name.replace('v', '');

        updates.push({
          plugin,
          latestVersion,
          hasUpdate: this.compareVersions(plugin.version, latestVersion) < 0,
        });
      } catch (err) {
        console.error(`Failed to check updates for ${plugin.id}:`, err);
      }
    }

    return updates;
  }

  /**
   * Compare versions (semver)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }

    return 0;
  }
}
```

#### **src/contexts/PluginContext.tsx** - State Management
```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { PluginService } from '@/services/PluginService';
import { InstalledPlugin, PluginRegistryEntry } from '@/types/plugin';

interface PluginContextType {
  installedPlugins: InstalledPlugin[];
  availablePlugins: PluginRegistryEntry[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchRegistry(): Promise<void>;
  installPlugin(repositoryUrl: string, version?: string): Promise<void>;
  uninstallPlugin(pluginId: string): Promise<void>;
  togglePlugin(pluginId: string): Promise<void>;
  checkUpdates(): Promise<void>;
}

const PluginContext = createContext<PluginContextType | undefined>(undefined);

export function PluginProvider({ children }: { children: ReactNode }) {
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [availablePlugins, setAvailablePlugins] = useState<PluginRegistryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pluginService = new PluginService(
    window.electronAPI.getPluginsDirectory()
  );

  // Load installed plugins on mount
  useEffect(() => {
    loadInstalledPlugins();
    fetchRegistry();
  }, []);

  const loadInstalledPlugins = async () => {
    try {
      const plugins = await pluginService.listInstalled();
      setInstalledPlugins(plugins);
    } catch (err) {
      console.error('Failed to load installed plugins:', err);
      setError(err instanceof Error ? err.message : 'Failed to load plugins');
    }
  };

  const fetchRegistry = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const plugins = await pluginService.fetchRegistry();
      setAvailablePlugins(plugins);
    } catch (err) {
      console.error('Failed to fetch registry:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch registry');
    } finally {
      setIsLoading(false);
    }
  };

  const installPlugin = async (repositoryUrl: string, version?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await window.electronAPI.installPlugin({ repositoryUrl, version });
      await loadInstalledPlugins();
    } catch (err) {
      console.error('Failed to install plugin:', err);
      setError(err instanceof Error ? err.message : 'Failed to install plugin');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const uninstallPlugin = async (pluginId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      await window.electronAPI.uninstallPlugin({ pluginId });
      await loadInstalledPlugins();
    } catch (err) {
      console.error('Failed to uninstall plugin:', err);
      setError(err instanceof Error ? err.message : 'Failed to uninstall plugin');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlugin = async (pluginId: string) => {
    try {
      const plugin = installedPlugins.find(p => p.id === pluginId);
      if (!plugin) return;

      if (plugin.isEnabled) {
        await window.electronAPI.disablePlugin({ pluginId });
      } else {
        await window.electronAPI.enablePlugin({ pluginId });
      }

      await loadInstalledPlugins();
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
      setError(err instanceof Error ? err.message : 'Failed to toggle plugin');
      throw err;
    }
  };

  const checkUpdates = async () => {
    try {
      const updates = await pluginService.checkForUpdates(installedPlugins);
      // Handle updates (show notifications, etc.)
      console.log('Available updates:', updates.filter(u => u.hasUpdate));
    } catch (err) {
      console.error('Failed to check updates:', err);
    }
  };

  return (
    <PluginContext.Provider
      value={{
        installedPlugins,
        availablePlugins,
        isLoading,
        error,
        fetchRegistry,
        installPlugin,
        uninstallPlugin,
        togglePlugin,
        checkUpdates,
      }}
    >
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins() {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePlugins must be used within PluginProvider');
  }
  return context;
}
```

#### **electron/plugin-loader.ts** - Secure Plugin Execution
```typescript
import { PluginManifest, PluginInstance, DocHubAPI } from '../src/types/plugin';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { VM } from 'vm2';

export class PluginLoader {
  private loadedPlugins = new Map<string, PluginInstance>();
  private pluginsDir: string;

  constructor(pluginsDirectory: string) {
    this.pluginsDir = pluginsDirectory;
  }

  /**
   * Load and execute plugin in sandboxed environment
   */
  async loadPlugin(manifest: PluginManifest, api: DocHubAPI): Promise<PluginInstance> {
    const pluginPath = join(this.pluginsDir, manifest.id, manifest.main);
    const pluginCode = await readFile(pluginPath, 'utf-8');

    // Create sandboxed VM
    const vm = new VM({
      timeout: 5000,
      sandbox: {
        console,
        require: this.createSafeRequire(manifest.permissions),
        dochub: api,
      },
    });

    // Execute plugin code
    const plugin = vm.run(pluginCode) as PluginInstance;

    // Validate plugin structure
    if (typeof plugin.activate !== 'function' || typeof plugin.deactivate !== 'function') {
      throw new Error('Plugin must export activate() and deactivate() methods');
    }

    this.loadedPlugins.set(manifest.id, plugin);
    return plugin;
  }

  /**
   * Create safe require function based on permissions
   */
  private createSafeRequire(permissions: string[]) {
    const allowedModules = ['path', 'url'];

    if (permissions.includes('filesystem')) {
      allowedModules.push('fs');
    }

    if (permissions.includes('network')) {
      allowedModules.push('https', 'http');
    }

    return (moduleName: string) => {
      if (allowedModules.includes(moduleName)) {
        return require(moduleName);
      }
      throw new Error(`Module '${moduleName}' is not allowed. Missing permission.`);
    };
  }

  /**
   * Activate plugin
   */
  async activatePlugin(pluginId: string, api: DocHubAPI): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }

    await plugin.activate(api);
  }

  /**
   * Deactivate plugin
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginId);
    if (!plugin) return;

    await plugin.deactivate();
  }

  /**
   * Unload plugin
   */
  unloadPlugin(pluginId: string): void {
    this.loadedPlugins.delete(pluginId);
  }
}
```

---

### **B. Electron IPC Handlers (electron/main.ts)**

```typescript
import { PluginLoader } from './plugin-loader';
import { PluginService } from '../src/services/PluginService';
import { app } from 'electron';
import { join } from 'path';

const pluginsDir = join(app.getPath('userData'), 'plugins');
const pluginService = new PluginService(pluginsDir);
const pluginLoader = new PluginLoader(pluginsDir);

// Get plugins directory
ipcMain.handle('plugins:get-directory', () => {
  return pluginsDir;
});

// Install plugin
ipcMain.handle('plugins:install', async (event, { repositoryUrl, version }) => {
  try {
    const manifest = await pluginService.installPlugin(repositoryUrl, version);
    return { success: true, manifest };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Installation failed'
    };
  }
});

// Uninstall plugin
ipcMain.handle('plugins:uninstall', async (event, { pluginId }) => {
  try {
    // Deactivate if loaded
    await pluginLoader.deactivatePlugin(pluginId);
    pluginLoader.unloadPlugin(pluginId);

    // Remove from filesystem
    await pluginService.uninstallPlugin(pluginId);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Uninstallation failed'
    };
  }
});

// Enable plugin
ipcMain.handle('plugins:enable', async (event, { pluginId }) => {
  try {
    const manifest = await pluginService.loadPlugin(pluginId);
    const api = createDocHubAPI(); // Create API object
    const plugin = await pluginLoader.loadPlugin(manifest, api);
    await pluginLoader.activatePlugin(pluginId, api);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to enable plugin'
    };
  }
});

// Disable plugin
ipcMain.handle('plugins:disable', async (event, { pluginId }) => {
  try {
    await pluginLoader.deactivatePlugin(pluginId);
    pluginLoader.unloadPlugin(pluginId);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to disable plugin'
    };
  }
});

// Create DocHub API for plugins
function createDocHubAPI(): DocHubAPI {
  return {
    document: {
      getActive: () => {
        // Return active document
      },
      process: async (options) => {
        // Process document
      },
      export: async (format, options) => {
        // Export document
      },
    },
    ui: {
      showNotification: (message, type) => {
        mainWindow?.webContents.send('plugin:notification', { message, type });
      },
      createPanel: (options) => {
        // Create panel
      },
      createStatusBarItem: () => {
        // Create status bar item
      },
    },
    storage: {
      get: async (key) => {
        // Get from storage
      },
      set: async (key, value) => {
        // Set in storage
      },
      delete: async (key) => {
        // Delete from storage
      },
    },
    session: {
      getCurrent: () => {
        // Get current session
      },
      create: (name) => {
        // Create session
      },
      close: (id) => {
        // Close session
      },
    },
  };
}
```

---

### **C. Plugin SDK Package** (@dochub/plugin-sdk)

Create separate npm package for plugin developers:

#### **package.json**
```json
{
  "name": "@dochub/plugin-sdk",
  "version": "1.0.0",
  "description": "SDK for building DocHub plugins",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["dochub", "plugin", "sdk"],
  "author": "DocHub Team",
  "license": "MIT"
}
```

#### **src/index.ts**
```typescript
export interface DocHubAPI {
  document: {
    getActive(): Document | null;
    process(options: ProcessingOptions): Promise<Result>;
    export(format: string, options: any): Promise<Buffer>;
  };
  ui: {
    showNotification(message: string, type?: 'info' | 'success' | 'error'): void;
    createPanel(options: PanelOptions): Panel;
    createStatusBarItem(): StatusBarItem;
  };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };
  session: {
    getCurrent(): Session | null;
    create(name: string): Session;
    close(id: string): void;
  };
}

export abstract class Plugin {
  /**
   * Called when plugin is activated
   */
  abstract activate(api: DocHubAPI): Promise<void>;

  /**
   * Called when plugin is deactivated
   */
  abstract deactivate(): Promise<void>;
}

// Helper types
export interface ProcessingOptions {
  // Processing configuration
}

export interface Result {
  success: boolean;
  // Result data
}

export interface PanelOptions {
  title: string;
  content: string;
}

export interface Panel {
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface StatusBarItem {
  text: string;
  show(): void;
  hide(): void;
  dispose(): void;
}
```

---

## 4. Plugin Discovery & Installation Flow

### **User Journey**

1. **Browse Plugins** → Plugins page fetches registry from GitHub
   ```typescript
   const plugins = await fetch('https://raw.githubusercontent.com/.../plugins/document/');
   ```

2. **Click Install** → Downloads latest release from GitHub
   ```typescript
   const release = await fetch('https://api.github.com/repos/.../releases/latest');
   const asset = release.assets.find(a => a.name === 'plugin.zip');
   ```

3. **Validate** → Check manifest, permissions, compatibility
   ```typescript
   validateManifest(manifest);
   checkCompatibility(manifest.minAppVersion, appVersion);
   ```

4. **Extract** → Unzip to `~/.dochub/plugins/{plugin-id}/`
   ```typescript
   const zip = new AdmZip(buffer);
   zip.extractAllTo(pluginDir, true);
   ```

5. **Load** → Execute plugin in sandboxed environment
   ```typescript
   const vm = new VM({ sandbox: { dochub: api } });
   const plugin = vm.run(pluginCode);
   ```

6. **Enable** → Plugin hooks into app lifecycle
   ```typescript
   await plugin.activate(docHubAPI);
   ```

### **Update Flow**

1. **Check for Updates** → Compare local version with GitHub release
   ```typescript
   const latest = await fetch('.../releases/latest');
   const hasUpdate = compareVersions(installed.version, latest.tag_name) < 0;
   ```

2. **Notify User** → Show update badge in Plugins page

3. **Download** → Fetch new release and replace old files

4. **Reload** → Deactivate old plugin, activate new version

---

## 5. Security & Sandboxing

### **Permission System**
```typescript
const PERMISSION_LEVELS = {
  'filesystem': {
    label: 'Access local files',
    risk: 'high',
    description: 'Can read and write files on your computer',
  },
  'network': {
    label: 'Make network requests',
    risk: 'medium',
    description: 'Can send data over the internet',
  },
  'document:read': {
    label: 'Read document content',
    risk: 'low',
    description: 'Can access document text and metadata',
  },
  'document:write': {
    label: 'Modify documents',
    risk: 'medium',
    description: 'Can change document content',
  },
  'settings:read': {
    label: 'Read app settings',
    risk: 'low',
    description: 'Can view application configuration',
  },
  'settings:write': {
    label: 'Modify app settings',
    risk: 'high',
    description: 'Can change application configuration',
  },
};
```

### **Sandboxing Strategy**
- ✅ Use Node.js `vm2` module for script isolation
- ✅ Whitelist allowed Node APIs based on permissions
- ✅ Deny direct filesystem access (use permission-based proxies)
- ✅ Rate limit network requests (max 100/minute)
- ✅ Timeout long-running operations (5 seconds default)
- ✅ Memory limit per plugin (256MB)
- ✅ No access to Electron internals (BrowserWindow, ipcMain, etc.)

---

## 6. GitHub Actions Workflow (For Plugin Repos)

### **.github/workflows/release.yml**
```yaml
name: Build and Release Plugin

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build plugin
        run: npm run build

      - name: Package plugin
        run: |
          mkdir -p release
          zip -r release/plugin.zip dist plugin.json README.md LICENSE icon.png

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            release/plugin.zip
            plugin.json
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 7. Implementation Steps

### **Phase 1: Infrastructure** (Week 1-2)
1. ✅ Create `src/types/plugin.ts` with all plugin types (~500 lines)
2. ✅ Create `src/services/PluginService.ts` with core logic (~800 lines)
3. ✅ Create `src/contexts/PluginContext.tsx` for state (~400 lines)
4. ✅ Add IPC handlers in `electron/main.ts` (~300 lines)
5. ✅ Create plugin storage directory structure
6. ✅ Install dependencies: `adm-zip`, `vm2`

### **Phase 2: Registry** (Week 3)
1. ✅ Create `DocHub-Plugin-Registry` GitHub repo
2. ✅ Populate with initial plugin entries (5-10 plugins)
3. ✅ Create `verified.json` for official plugins
4. ✅ Set up GitHub API integration for stats (stars, downloads)
5. ✅ Create registry fetching logic

### **Phase 3: UI Updates** (Week 4)
1. ✅ Update `src/pages/Plugins.tsx` to use real data from PluginContext
2. ✅ Add plugin detail modal with permissions display
3. ✅ Add plugin settings drawer (per-plugin configuration)
4. ✅ Add update notification system with badges
5. ✅ Add loading states and error handling

### **Phase 4: Plugin SDK** (Week 5)
1. ✅ Create `@dochub/plugin-sdk` npm package
2. ✅ Document plugin development guide (README)
3. ✅ Create starter template repository (`dochub-plugin-template`)
4. ✅ Publish SDK to npm
5. ✅ Create example plugin (Hello World)

### **Phase 5: Security** (Week 6)
1. ✅ Implement permission system with user approval
2. ✅ Add plugin sandboxing with vm2
3. ✅ Add code signing verification (optional)
4. ✅ Add malware scanning integration (VirusTotal API - optional)
5. ✅ Create security documentation

### **Phase 6: First Official Plugins** (Week 7-8)
1. ✅ **PDF Export plugin** - Export documents to PDF
2. ✅ **Cloud Sync plugin** - Sync to Dropbox/Google Drive
3. ✅ **Theme Builder plugin** - Custom theme creation
4. ✅ **Batch Rename plugin** - Auto-rename processed files
5. ✅ Test all plugins thoroughly

---

## 8. Example: Installing a Plugin

### **User clicks "Install" on PDF Export plugin**

```typescript
// 1. User clicks install button
<Button onClick={() => installPlugin('https://github.com/DocHubPlugins/pdf-export')}>
  Install
</Button>

// 2. PluginContext.installPlugin() is called
const installPlugin = async (repositoryUrl: string) => {
  setIsLoading(true);

  try {
    // 3. Send to Electron main process
    const result = await window.electronAPI.installPlugin({
      repositoryUrl,
      version: 'latest'
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    // 4. Reload installed plugins
    await loadInstalledPlugins();

    // 5. Show success notification
    toast.success('Plugin installed successfully!');
  } catch (error) {
    toast.error('Failed to install plugin');
  } finally {
    setIsLoading(false);
  }
};

// 6. Main process handles installation
ipcMain.handle('plugins:install', async (event, { repositoryUrl, version }) => {
  // Fetch latest release
  const release = await fetch(
    'https://api.github.com/repos/DocHubPlugins/pdf-export/releases/latest'
  );
  const releaseData = await release.json();

  // Download plugin.zip
  const asset = releaseData.assets.find(a => a.name === 'plugin.zip');
  const buffer = await downloadFile(asset.browser_download_url);

  // Extract to plugins directory
  const zip = new AdmZip(buffer);
  const pluginDir = join(pluginsDir, 'dochub-pdf-export');
  zip.extractAllTo(pluginDir, true);

  // Read and validate manifest
  const manifest = JSON.parse(
    await fs.readFile(join(pluginDir, 'plugin.json'), 'utf-8')
  );

  validateManifest(manifest);

  return { success: true, manifest };
});

// 7. User enables the plugin
<Button onClick={() => togglePlugin('dochub-pdf-export')}>
  Enable
</Button>

// 8. Plugin is loaded and activated
const plugin = await pluginLoader.loadPlugin(manifest, docHubAPI);
await plugin.activate(docHubAPI);

// 9. Plugin is now active and can hook into app lifecycle
```

---

## 9. File Structure After Implementation

```
Documentation_Hub/
├── src/
│   ├── types/
│   │   └── plugin.ts                    # NEW
│   ├── services/
│   │   └── PluginService.ts             # NEW
│   ├── contexts/
│   │   └── PluginContext.tsx            # NEW
│   ├── components/
│   │   └── plugins/
│   │       ├── PluginDetailModal.tsx    # NEW
│   │       ├── PluginPermissions.tsx    # NEW
│   │       └── PluginSettings.tsx       # NEW
│   └── pages/
│       └── Plugins.tsx                  # MODIFIED
├── electron/
│   ├── main.ts                          # MODIFIED (add IPC handlers)
│   └── plugin-loader.ts                 # NEW
├── package.json                         # MODIFIED (add dependencies)
└── PLUGIN_MARKETPLACE_PLAN.md          # This file

External Repositories:
├── DocHub-Plugin-Registry/              # NEW GitHub repo
│   ├── plugins/
│   │   ├── document/
│   │   ├── ui/
│   │   ├── integration/
│   │   └── automation/
│   └── verified.json
├── dochub-plugin-sdk/                   # NEW npm package
│   ├── src/
│   │   └── index.ts
│   └── package.json
└── dochub-plugin-template/              # NEW template repo
    ├── src/
    │   └── index.ts
    ├── plugin.json
    └── .github/workflows/release.yml
```

---

## 10. Dependencies to Add

### **package.json**
```json
{
  "dependencies": {
    "adm-zip": "^0.5.10",        // ZIP extraction
    "vm2": "^3.9.19",             // Sandboxing
    "semver": "^7.5.4"            // Version comparison
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.5"
  }
}
```

---

## 11. Security Considerations

### **Permission Approval UI**
When a plugin requests permissions, show a dialog:

```
┌─────────────────────────────────────────┐
│  PDF Export wants to access:            │
│                                          │
│  ⚠️  Filesystem Access (HIGH RISK)      │
│     Can read and write files            │
│                                          │
│  📄  Read Documents (LOW RISK)          │
│     Can access document content         │
│                                          │
│  [Cancel]              [Allow & Install]│
└─────────────────────────────────────────┘
```

### **Code Signing (Optional)**
- Verified plugins signed with DocHub private key
- Display "Verified" badge for signed plugins
- Warn users about unsigned plugins

### **Rate Limiting**
```typescript
class RateLimiter {
  private requests = new Map<string, number[]>();

  check(pluginId: string, limit: number = 100): boolean {
    const now = Date.now();
    const windowMs = 60000; // 1 minute

    const timestamps = this.requests.get(pluginId) || [];
    const recent = timestamps.filter(t => now - t < windowMs);

    if (recent.length >= limit) {
      throw new Error('Rate limit exceeded');
    }

    recent.push(now);
    this.requests.set(pluginId, recent);

    return true;
  }
}
```

---

## 12. Testing Strategy

### **Unit Tests**
- PluginService: Download, install, uninstall, updates
- PluginLoader: Load, sandbox, activate, deactivate
- Manifest validation
- Version comparison

### **Integration Tests**
- Full installation flow
- Plugin activation/deactivation
- Permission system
- API access from plugins

### **Security Tests**
- Sandbox escape attempts
- Unauthorized file access
- Network abuse
- Memory leaks

---

## 13. Documentation

### **For Plugin Developers**

#### **Quick Start Guide**
```markdown
# Creating a DocHub Plugin

## 1. Clone the template
git clone https://github.com/DocHub/dochub-plugin-template my-plugin
cd my-plugin

## 2. Update plugin.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  ...
}

## 3. Implement the plugin
// src/index.ts
import { Plugin, DocHubAPI } from '@dochub/plugin-sdk';

export default class MyPlugin extends Plugin {
  async activate(api: DocHubAPI) {
    api.ui.showNotification('My Plugin activated!');
  }

  async deactivate() {
    console.log('Deactivating...');
  }
}

## 4. Build and test
npm install
npm run build
npm test

## 5. Publish
git tag v1.0.0
git push origin v1.0.0
```

### **For Users**

#### **Installing Plugins**
```markdown
# How to Install Plugins

1. Open Documentation Hub
2. Navigate to Plugins page
3. Browse or search for plugins
4. Click "Install" on desired plugin
5. Review permissions and click "Allow"
6. Plugin will download and install automatically
7. Enable the plugin to start using it
```

---

## 14. Estimated Implementation Time

| Phase | Duration | Team Size |
|-------|----------|-----------|
| Infrastructure | 2 weeks | 1 developer |
| Registry | 1 week | 1 developer |
| UI Updates | 1 week | 1 developer |
| Plugin SDK | 1 week | 1 developer |
| Security | 1 week | 1 developer |
| Official Plugins | 2 weeks | 2 developers |
| Testing & QA | 1 week | 2 developers |
| Documentation | 1 week | 1 developer |
| **Total** | **10 weeks** | **1-2 developers** |

---

## 15. Success Metrics

- **Developer Adoption**: 10+ community plugins within 3 months
- **User Adoption**: 50% of users install at least 1 plugin
- **Plugin Quality**: Average rating > 4.0 stars
- **Security**: Zero critical security incidents
- **Performance**: Plugin load time < 500ms

---

## 16. Future Enhancements

- **Plugin Marketplace Website**: Dedicated website for browsing plugins
- **Plugin Analytics**: Track usage, performance, errors
- **Plugin Themes**: Allow plugins to provide custom themes
- **Plugin Dependencies**: Support for plugin-to-plugin dependencies
- **Plugin CLI**: Command-line tool for plugin development
- **Hot Reload**: Update plugins without app restart
- **Plugin Debugger**: Built-in debugging tools for plugin developers
- **Revenue Sharing**: Paid plugins with revenue sharing model

---

## Summary

This GitHub-based plugin marketplace provides:

✅ **Decentralized Distribution** - No central server required
✅ **Easy Plugin Development** - Simple SDK and template
✅ **Secure Execution** - Sandboxing and permissions
✅ **Automatic Updates** - Check GitHub releases
✅ **Community Driven** - Anyone can publish plugins
✅ **Official Verification** - Verified badge for trusted plugins

**Total Implementation**: ~3,000 lines of code + 3 new repositories over 10 weeks
