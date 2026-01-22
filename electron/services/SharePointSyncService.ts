/**
 * SharePointSyncService - Main Process
 * Handles SharePoint file download via Microsoft Graph API
 *
 * This service runs in the Electron main process and provides
 * authenticated access to SharePoint files using MSAL app-only
 * (client credentials) authentication flow.
 *
 * @architecture Main Process Service
 * @security Uses client credentials flow - requires Azure AD app registration
 * @performance Supports chunked download with progress reporting
 */

import { createHash } from 'crypto';
import { BrowserWindow } from 'electron';
import {
  ConfidentialClientApplication,
  Configuration,
  ClientCredentialRequest,
} from '@azure/msal-node';
import * as XLSX from 'xlsx';
import { logger } from '../../src/utils/logger';
import { getDictionaryService } from './DictionaryService';
import type {
  DictionaryEntry,
  SharePointConfig,
  SyncProgressUpdate,
  DictionarySyncResponse,
} from '../../src/types/dictionary';

const log = logger.namespace('SharePointSyncService');

/**
 * Service for syncing dictionary from SharePoint
 */
export class SharePointSyncService {
  private msalApp: ConfidentialClientApplication | null = null;
  private clientSecret: string | null = null;
  private config: SharePointConfig | null = null;
  private schedulerInterval: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;

  constructor() {}

  /**
   * Set the main window for sending progress updates
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Configure the service with SharePoint details
   */
  configure(config: SharePointConfig): void {
    this.config = config;
    log.info('SharePoint sync configured', {
      siteUrl: config.siteUrl,
      tenantId: config.tenantId,
    });
  }

  /**
   * Set client secret securely (not stored in settings)
   */
  setClientSecret(secret: string): { success: boolean; error?: string } {
    try {
      this.clientSecret = secret;

      // Reinitialize MSAL if config is available
      if (this.config) {
        this.initializeMsal();
      }

      log.info('Client secret configured');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to set client secret', { error: message });
      return { success: false, error: message };
    }
  }

  /**
   * Initialize MSAL client application
   */
  private initializeMsal(): void {
    if (!this.config || !this.clientSecret) {
      throw new Error('Configuration or client secret not set');
    }

    const msalConfig: Configuration = {
      auth: {
        clientId: this.config.clientId,
        authority: `https://login.microsoftonline.com/${this.config.tenantId}`,
        clientSecret: this.clientSecret,
      },
    };

    this.msalApp = new ConfidentialClientApplication(msalConfig);
    log.info('MSAL client initialized');
  }

  /**
   * Get access token using client credentials flow
   */
  private async getAccessToken(): Promise<string> {
    if (!this.msalApp) {
      this.initializeMsal();
    }

    if (!this.msalApp) {
      throw new Error('MSAL client not initialized');
    }

    const tokenRequest: ClientCredentialRequest = {
      scopes: ['https://graph.microsoft.com/.default'],
    };

    const response = await this.msalApp.acquireTokenByClientCredential(tokenRequest);

    if (!response?.accessToken) {
      throw new Error('Failed to acquire access token');
    }

    return response.accessToken;
  }

  /**
   * Send progress update to renderer
   */
  private sendProgress(update: SyncProgressUpdate): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('dictionary:sync-progress', update);
    }

    const dictionaryService = getDictionaryService();
    dictionaryService.updateSyncStatus({
      syncInProgress: update.phase !== 'complete' && update.phase !== 'error',
      syncProgress: update.progress,
      syncError: update.phase === 'error' ? update.message : null,
    });
  }

  /**
   * Download the dictionary file from SharePoint
   */
  async sync(): Promise<DictionarySyncResponse> {
    const startTime = Date.now();
    const dictionaryService = getDictionaryService();

    try {
      if (!this.config) {
        throw new Error('SharePoint configuration not set');
      }

      if (!this.clientSecret) {
        throw new Error('Client secret not set');
      }

      // Initialize dictionary service if needed
      await dictionaryService.initialize();

      // Phase 1: Authentication
      this.sendProgress({
        phase: 'authenticating',
        progress: 5,
        message: 'Authenticating with Microsoft Graph...',
      });

      const accessToken = await this.getAccessToken();

      // Phase 2: Download file
      this.sendProgress({
        phase: 'downloading',
        progress: 20,
        message: 'Downloading dictionary file from SharePoint...',
      });

      const fileBuffer = await this.downloadFile(accessToken);
      const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

      // Check if file has changed
      const currentHash = dictionaryService.getMetadata('fileHash');
      if (currentHash === fileHash) {
        this.sendProgress({
          phase: 'complete',
          progress: 100,
          message: 'Dictionary is already up to date',
        });

        return {
          success: true,
          entriesImported: 0,
          duration: Date.now() - startTime,
        };
      }

      // Phase 3: Parse Excel
      this.sendProgress({
        phase: 'parsing',
        progress: 50,
        message: 'Parsing dictionary file...',
      });

      const entries = this.parseExcelFile(fileBuffer);

      // Phase 4: Import to database
      this.sendProgress({
        phase: 'importing',
        progress: 70,
        message: `Importing ${entries.length.toLocaleString()} entries...`,
        totalEntries: entries.length,
      });

      // Clear existing entries
      dictionaryService.clearEntries();

      // Import new entries
      const result = dictionaryService.importEntries(entries, (processed, total) => {
        const progress = 70 + Math.floor((processed / total) * 25);
        this.sendProgress({
          phase: 'importing',
          progress,
          message: `Importing entries... ${processed.toLocaleString()} / ${total.toLocaleString()}`,
          entriesProcessed: processed,
          totalEntries: total,
        });
      });

      if (!result.success) {
        throw new Error(result.error || 'Import failed');
      }

      // Save file hash
      dictionaryService.setMetadata('fileHash', fileHash);

      // Phase 5: Complete
      this.sendProgress({
        phase: 'complete',
        progress: 100,
        message: `Successfully imported ${result.imported.toLocaleString()} entries`,
        entriesProcessed: result.imported,
        totalEntries: result.imported,
      });

      const duration = Date.now() - startTime;
      log.info('Dictionary sync completed', {
        entries: result.imported,
        duration: `${duration}ms`,
      });

      return {
        success: true,
        entriesImported: result.imported,
        duration,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Dictionary sync failed', { error: message });

      this.sendProgress({
        phase: 'error',
        progress: 0,
        message: `Sync failed: ${message}`,
      });

      dictionaryService.updateSyncStatus({
        syncInProgress: false,
        lastSyncSuccess: false,
        syncError: message,
      });

      return {
        success: false,
        entriesImported: 0,
        duration: Date.now() - startTime,
        error: message,
      };
    }
  }

  /**
   * Download file from SharePoint using Microsoft Graph
   */
  private async downloadFile(accessToken: string): Promise<Buffer> {
    if (!this.config) {
      throw new Error('Configuration not set');
    }

    // Build Graph API URL for file download
    // Format: /sites/{site-id}/drive/root:/{path}:/content
    // Or: /sites/{hostname}:{site-path}:/drive/root:/{path}:/content
    const siteUrl = new URL(this.config.siteUrl);
    const sitePath = siteUrl.pathname;
    const hostname = siteUrl.hostname;

    // Construct the Graph API endpoint
    const encodedPath = encodeURIComponent(this.config.documentLibraryPath);
    const graphUrl = `https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}:/drive/root:/${encodedPath}:/content`;

    log.info('Downloading file from SharePoint', { url: graphUrl });

    const response = await fetch(graphUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Download failed: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Parse Excel file and extract dictionary entries
   *
   * Looks for the "Daily_Inventory" sheet and optionally the "Dictionary_Table" table.
   * Extracts Document_ID, Content_ID, Title, and Status columns.
   */
  parseExcelFile(buffer: Buffer): DictionaryEntry[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Find the Daily_Inventory sheet
    const sheetName = 'Daily_Inventory';
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found in workbook`);
    }

    // Try to find the Dictionary_Table range
    // Excel tables are stored in workbook metadata
    let tableRange: string | undefined;
    const tableName = 'Dictionary_Table';

    // Check for named ranges (tables appear as defined names)
    if (workbook.Workbook?.Names) {
      const tableNameEntry = workbook.Workbook.Names.find(
        (n: { Name: string; Ref?: string }) =>
          n.Name === tableName || n.Name === `${sheetName}!${tableName}`
      );
      if (tableNameEntry?.Ref) {
        // Extract the range from the reference (e.g., "Daily_Inventory!$A$1:$D$1000")
        const refMatch = tableNameEntry.Ref.match(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/);
        if (refMatch) {
          tableRange = `${refMatch[1]}${refMatch[2]}:${refMatch[3]}${refMatch[4]}`;
          log.info(`Found table "${tableName}" with range: ${tableRange}`);
        }
      }
    }

    // Convert to JSON with header row, using table range if found
    const parseOptions: XLSX.Sheet2JSONOpts = {
      raw: false,
      defval: '',
    };
    if (tableRange) {
      parseOptions.range = tableRange;
    }

    const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, parseOptions);

    // Map to DictionaryEntry format - only extract required columns
    const entries: DictionaryEntry[] = rawData.map((row) => ({
      Document_ID: String(row['Document_ID'] || ''),
      Content_ID: String(row['Content_ID'] || ''),
      Title: String(row['Title'] || ''),
      Summary: String(row['Summary'] || ''),
      Type: String(row['Type'] || ''),
      Release_Date: this.parseExcelDate(row['Release_Date']),
      Expiration_Date: this.parseExcelDate(row['Expiration_Date']),
      Status: String(row['Status'] || ''),
      Owner: String(row['Owner'] || ''),
      BPO: String(row['BPO'] || ''),
      LOB: String(row['LOB'] || ''),
      Last_Published_By: String(row['Last_Published_By'] || ''),
    }));

    // Filter out entries without Document_ID
    const validEntries = entries.filter((e) => e.Document_ID.trim() !== '');

    log.info('Parsed Excel file', {
      totalRows: rawData.length,
      validEntries: validEntries.length,
      usedTableRange: tableRange || 'full sheet',
    });

    return validEntries;
  }

  /**
   * Parse Excel date (handles Excel serial date numbers)
   */
  private parseExcelDate(value: unknown): string {
    if (!value) return '';

    // If it's already a string date, return it
    if (typeof value === 'string') {
      return value;
    }

    // If it's a number, convert from Excel serial date
    if (typeof value === 'number') {
      // Excel serial date: days since Dec 30, 1899
      const date = new Date((value - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }

    return String(value);
  }

  /**
   * Start automatic sync scheduler
   */
  startScheduler(intervalHours: number): void {
    // Clear existing scheduler
    this.stopScheduler();

    const intervalMs = intervalHours * 60 * 60 * 1000;

    // Calculate next sync time
    const dictionaryService = getDictionaryService();
    const nextSync = new Date(Date.now() + intervalMs).toISOString();
    dictionaryService.updateSyncStatus({ nextScheduledSync: nextSync });

    this.schedulerInterval = setInterval(async () => {
      log.info('Running scheduled dictionary sync');
      await this.sync();

      // Update next sync time
      const nextSyncTime = new Date(Date.now() + intervalMs).toISOString();
      dictionaryService.updateSyncStatus({ nextScheduledSync: nextSyncTime });
    }, intervalMs);

    log.info('Sync scheduler started', { intervalHours, nextSync });
  }

  /**
   * Stop automatic sync scheduler
   */
  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;

      const dictionaryService = getDictionaryService();
      dictionaryService.updateSyncStatus({ nextScheduledSync: null });

      log.info('Sync scheduler stopped');
    }
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.schedulerInterval !== null;
  }
}

// Singleton instance
let sharePointSyncServiceInstance: SharePointSyncService | null = null;

export function getSharePointSyncService(): SharePointSyncService {
  if (!sharePointSyncServiceInstance) {
    sharePointSyncServiceInstance = new SharePointSyncService();
  }
  return sharePointSyncServiceInstance;
}
