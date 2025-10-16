/**
 * Path validation utilities for secure file operations
 *
 * Prevents path traversal attacks and ensures file operations
 * are restricted to safe directories.
 *
 * Security considerations:
 * - Blocks path traversal attempts (../)
 * - Validates paths are within allowed directories
 * - Sanitizes file names
 * - Prevents access to system files
 */

import * as path from 'path';

/**
 * Checks if a path contains path traversal attempts
 */
export function hasPathTraversal(filePath: string): boolean {
  // Normalize path to resolve any .. or . segments
  const normalized = path.normalize(filePath);

  // Check for parent directory references
  if (normalized.includes('..')) {
    return true;
  }

  // Check for absolute path attempts on Windows
  if (process.platform === 'win32') {
    // Check for drive letter changes (C:, D:, etc.)
    const driveLetter = filePath.match(/^[a-zA-Z]:/);
    const normalizedDrive = normalized.match(/^[a-zA-Z]:/);

    if (driveLetter && normalizedDrive) {
      if (driveLetter[0].toLowerCase() !== normalizedDrive[0].toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a path is within an allowed directory
 */
export function isWithinDirectory(filePath: string, allowedDir: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);

  // On Windows, compare case-insensitively
  if (process.platform === 'win32') {
    return resolvedPath.toLowerCase().startsWith(resolvedAllowedDir.toLowerCase());
  }

  return resolvedPath.startsWith(resolvedAllowedDir);
}

/**
 * Sanitizes a file name by removing dangerous characters
 */
export function sanitizeFileName(fileName: string): string {
  // Remove or replace dangerous characters
  // Allow: letters, numbers, spaces, dots, dashes, underscores
  return fileName.replace(/[^a-zA-Z0-9\s.\-_]/g, '_');
}

/**
 * Validates if a file path is safe to use
 *
 * @param filePath - The file path to validate
 * @param allowedDirectories - Optional array of allowed base directories
 * @returns Object with validation result and error message if invalid
 */
export function validateFilePath(
  filePath: string,
  allowedDirectories?: string[]
): { isValid: boolean; error?: string } {
  // Check for empty or null paths
  if (!filePath || filePath.trim() === '') {
    return {
      isValid: false,
      error: 'File path is empty',
    };
  }

  // Check for path traversal attempts
  if (hasPathTraversal(filePath)) {
    return {
      isValid: false,
      error: 'Path traversal attempt detected',
    };
  }

  // Check for dangerous characters in filename
  const fileName = path.basename(filePath);
  const dangerousChars = /[<>:"|?*]/;

  if (dangerousChars.test(fileName)) {
    return {
      isValid: false,
      error: 'File name contains illegal characters',
    };
  }

  // Validate against allowed directories if provided
  if (allowedDirectories && allowedDirectories.length > 0) {
    const isInAllowedDir = allowedDirectories.some((allowedDir) =>
      isWithinDirectory(filePath, allowedDir)
    );

    if (!isInAllowedDir) {
      return {
        isValid: false,
        error: 'File path is outside allowed directories',
      };
    }
  }

  // Check for system file access attempts
  const systemPaths = [
    '/etc',
    '/sys',
    '/proc',
    'C:\\Windows\\System32',
    'C:\\Program Files',
  ];

  const resolvedPath = path.resolve(filePath);
  const isSystemPath = systemPaths.some((sysPath) => {
    if (process.platform === 'win32') {
      return resolvedPath.toLowerCase().startsWith(sysPath.toLowerCase());
    }
    return resolvedPath.startsWith(sysPath);
  });

  if (isSystemPath) {
    return {
      isValid: false,
      error: 'Access to system files is not allowed',
    };
  }

  // Path is valid
  return { isValid: true };
}

/**
 * Gets common allowed directories for document operations
 * Uses Electron's app.getPath() when available
 */
export function getDefaultAllowedDirectories(): string[] {
  const allowedDirs: string[] = [];

  // User's home directory
  if (process.env.HOME) {
    allowedDirs.push(process.env.HOME);
  }

  if (process.env.USERPROFILE) {
    allowedDirs.push(process.env.USERPROFILE);
  }

  // Common document directories
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      allowedDirs.push(path.join(userProfile, 'Documents'));
      allowedDirs.push(path.join(userProfile, 'Desktop'));
      allowedDirs.push(path.join(userProfile, 'Downloads'));
    }
  } else {
    const home = process.env.HOME;
    if (home) {
      allowedDirs.push(path.join(home, 'Documents'));
      allowedDirs.push(path.join(home, 'Desktop'));
      allowedDirs.push(path.join(home, 'Downloads'));
    }
  }

  return allowedDirs;
}

/**
 * Validates and sanitizes a file path
 * Returns the sanitized path or throws an error
 */
export function validateAndSanitizePath(
  filePath: string,
  allowedDirectories?: string[]
): string {
  const validation = validateFilePath(filePath, allowedDirectories);

  if (!validation.isValid) {
    throw new Error(`Invalid file path: ${validation.error}`);
  }

  // Resolve to absolute path to prevent any relative path tricks
  const absolutePath = path.resolve(filePath);

  // Sanitize the filename
  const dir = path.dirname(absolutePath);
  const fileName = path.basename(absolutePath);
  const sanitizedFileName = sanitizeFileName(fileName);

  return path.join(dir, sanitizedFileName);
}
