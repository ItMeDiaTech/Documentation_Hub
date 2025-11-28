/**
 * Dictionary Types for Local SharePoint Dictionary Integration
 *
 * These types define the structure for storing and querying the
 * SharePoint Dictionary.xlsx file locally using SQLite.
 */

/**
 * Represents a single entry from the Dictionary.xlsx file
 * Matches the structure of the "Dictionary_Table" in "Daily_Inventory" sheet
 */
export interface DictionaryEntry {
  Document_ID: string;
  Content_ID: string;
  Title: string;
  Summary: string;
  Type: string;
  Release_Date: string;
  Expiration_Date: string;
  Status: string;
  Owner: string;
  BPO: string;
  LOB: string;
  Last_Published_By: string;
}

/**
 * Result of a dictionary lookup operation
 */
export interface DictionaryLookupResult {
  found: boolean;
  entry?: DictionaryEntry;
  lookupId: string;
  lookupType: 'Document_ID' | 'Content_ID';
}

/**
 * Batch lookup result for multiple IDs
 */
export interface DictionaryBatchLookupResult {
  results: Map<string, DictionaryLookupResult>;
  found: number;
  notFound: number;
  totalRequested: number;
}

/**
 * Current status of the dictionary sync operation
 */
export interface DictionarySyncStatus {
  enabled: boolean;
  lastSyncTime: string | null;
  lastSyncSuccess: boolean;
  totalEntries: number;
  syncInProgress: boolean;
  syncProgress: number;
  syncError: string | null;
  nextScheduledSync: string | null;
  fileHash: string | null;
}

/**
 * SharePoint configuration for dictionary download
 */
export interface SharePointConfig {
  siteUrl: string;
  documentLibraryPath: string;
  tenantId: string;
  clientId: string;
}

/**
 * Progress update during sync operation
 */
export interface SyncProgressUpdate {
  phase: 'authenticating' | 'downloading' | 'parsing' | 'importing' | 'complete' | 'error';
  progress: number;
  message: string;
  entriesProcessed?: number;
  totalEntries?: number;
}

/**
 * Response from dictionary initialization
 */
export interface DictionaryInitResponse {
  success: boolean;
  totalEntries: number;
  error?: string;
}

/**
 * Response from dictionary sync operation
 */
export interface DictionarySyncResponse {
  success: boolean;
  entriesImported: number;
  duration: number;
  error?: string;
}

/**
 * Response from setting credentials
 */
export interface DictionaryCredentialsResponse {
  success: boolean;
  error?: string;
}

/**
 * IPC channel names for dictionary operations
 */
export const DICTIONARY_IPC_CHANNELS = {
  INITIALIZE: 'dictionary:initialize',
  CONFIGURE_SYNC: 'dictionary:configure-sync',
  SYNC: 'dictionary:sync',
  START_SCHEDULER: 'dictionary:start-scheduler',
  STOP_SCHEDULER: 'dictionary:stop-scheduler',
  LOOKUP: 'dictionary:lookup',
  BATCH_LOOKUP: 'dictionary:batch-lookup',
  GET_STATUS: 'dictionary:get-status',
  SET_CREDENTIALS: 'dictionary:set-credentials',
  SYNC_PROGRESS: 'dictionary:sync-progress',
  SYNC_COMPLETE: 'dictionary:sync-complete',
} as const;
