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
 *
 * Note: Browser-compatible implementation without Node.js path module
 */

/**
 * Browser-compatible path utilities
 */
const pathUtils = {
  normalize(p: string): string {
    // Replace backslashes with forward slashes for consistency
    let normalized = p.replace(/\\/g, '/');

    // Remove duplicate slashes
    normalized = normalized.replace(/\/+/g, '/');

    // Handle . and .. segments
    const parts = normalized.split('/');
    const result: string[] = [];

    for (const part of parts) {
      if (part === '..' && result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else if (part !== '.' && part !== '') {
        result.push(part);
      }
    }

    return result.join('/');
  },

  resolve(...paths: string[]): string {
    let resolved = '';
    let isAbsolute = false;

    for (let i = paths.length - 1; i >= 0 && !isAbsolute; i--) {
      const p = paths[i];
      if (!p) continue;

      resolved = p + '/' + resolved;
      isAbsolute = /^([a-zA-Z]:)?\//.test(p);
    }

    resolved = this.normalize(resolved);
    return resolved || '.';
  },

  basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || '';
  },

  dirname(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    const parts = normalized.split('/');
    parts.pop();
    return parts.join('/') || '.';
  },

  join(...paths: string[]): string {
    return this.normalize(paths.join('/'));
  }
};

/**
 * Checks if a path contains path traversal attempts
 */
export function hasPathTraversal(filePath: string): boolean {
  // Normalize path to resolve any .. or . segments
  const normalized = pathUtils.normalize(filePath);

  // Check for parent directory references
  if (normalized.includes('..')) {
    return true;
  }

  // Check for absolute path attempts on Windows
  const isWindows = navigator.userAgent.includes('Windows');
  if (isWindows) {
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
  const resolvedPath = pathUtils.resolve(filePath);
  const resolvedAllowedDir = pathUtils.resolve(allowedDir);

  // On Windows, compare case-insensitively
  const isWindows = navigator.userAgent.includes('Windows');
  if (isWindows) {
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
  const fileName = pathUtils.basename(filePath);
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

  const resolvedPath = pathUtils.resolve(filePath);
  const isWindows = navigator.userAgent.includes('Windows');
  const isSystemPath = systemPaths.some((sysPath) => {
    if (isWindows) {
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
 * Note: Browser environment doesn't have access to environment variables
 * This function returns empty array in browser, should use IPC in Electron
 */
export function getDefaultAllowedDirectories(): string[] {
  // In browser context, we can't access environment variables or filesystem
  // This function should be called from Electron main process via IPC
  return [];
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
  const absolutePath = pathUtils.resolve(filePath);

  // Sanitize the filename
  const dir = pathUtils.dirname(absolutePath);
  const fileName = pathUtils.basename(absolutePath);
  const sanitizedFileName = sanitizeFileName(fileName);

  return pathUtils.join(dir, sanitizedFileName);
}
