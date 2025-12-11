/**
 * Electron API Guard Utilities
 *
 * Provides safe access to the Electron API exposed via contextBridge.
 * These utilities handle cases where the API might not be available:
 * - Running in a browser instead of Electron
 * - During initial page load before preload completes
 * - In test environments
 * - During hot module replacement (HMR) cycles
 */

import type { ElectronAPI } from '@/global.d';

/**
 * Check if the code is running in an Electron environment.
 *
 * @returns true if window.electronAPI is available
 */
export function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
}

/**
 * Get the Electron API, throwing if unavailable.
 *
 * @throws Error if not running in Electron environment
 * @returns The electronAPI object
 */
export function getElectronAPI(): ElectronAPI {
  if (!isElectronEnvironment()) {
    throw new Error(
      'Electron API not available. This feature requires running in the Electron desktop application.'
    );
  }
  return window.electronAPI;
}

/**
 * Get the Electron API with a feature-specific error message.
 *
 * @param feature - Name of the feature requiring Electron (for error message)
 * @throws Error if not running in Electron environment
 * @returns The electronAPI object
 */
export function requireElectronAPI(feature: string): ElectronAPI {
  if (!isElectronEnvironment()) {
    throw new Error(
      `Electron API not available - ${feature} requires running in the Electron desktop application.`
    );
  }
  return window.electronAPI;
}

/**
 * Safely check if a specific Electron API method is available.
 *
 * @param method - The method name to check (e.g., 'callPowerAutomateApi')
 * @returns true if the method exists and is callable
 */
export function hasElectronMethod(method: keyof ElectronAPI): boolean {
  return isElectronEnvironment() && typeof window.electronAPI[method] === 'function';
}
