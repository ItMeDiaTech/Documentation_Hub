import { logger } from './logger';

/**
 * Path Security Utilities
 * Provides comprehensive path validation to prevent directory traversal attacks
 */

const log = logger.namespace('PathSecurity');

/**
 * Validates that a file path is safe and doesn't contain traversal attempts
 * @param filePath The path to validate
 * @param allowedExtensions Optional array of allowed file extensions (e.g., ['.docx', '.doc'])
 * @returns true if path is safe, false otherwise
 */
export function isPathSafe(filePath: string, allowedExtensions?: string[]): boolean {
  if (!filePath || typeof filePath !== 'string') {
    log.warn('Invalid path: empty or not a string');
    return false;
  }

  // Check for null bytes (poison null byte attack)
  if (filePath.includes('\0')) {
    log.error('Security: Path contains null byte', filePath);
    return false;
  }

  // Check for directory traversal patterns
  const traversalPatterns = [
    '..',
    '../',
    '..\\',
    '%2e%2e',
    '%252e%252e',
    '..%2f',
    '..%5c',
    '%c0%ae%c0%ae',
    '0x2e0x2e',
  ];

  const lowerPath = filePath.toLowerCase();
  for (const pattern of traversalPatterns) {
    if (lowerPath.includes(pattern)) {
      log.error('Security: Path contains traversal pattern', { path: filePath, pattern });
      return false;
    }
  }

  // Check for absolute path indicators on different platforms
  const isAbsolute =
    filePath.startsWith('/') || // Unix absolute
    filePath.startsWith('\\') || // Windows UNC
    /^[a-zA-Z]:[\\/]/.test(filePath); // Windows drive letter

  if (!isAbsolute) {
    log.warn('Security: Path is not absolute', filePath);
    return false;
  }

  // Validate file extension if specified
  if (allowedExtensions && allowedExtensions.length > 0) {
    const hasValidExtension = allowedExtensions.some(ext =>
      filePath.toLowerCase().endsWith(ext.toLowerCase())
    );

    if (!hasValidExtension) {
      log.error('Security: File extension not allowed', {
        path: filePath,
        allowedExtensions
      });
      return false;
    }
  }

  // Check for suspicious double extensions that might bypass filters
  const suspiciousDoubleExtensions = [
    '.docx.exe',
    '.docx.scr',
    '.docx.bat',
    '.docx.cmd',
    '.docx.com',
    '.docx.pif',
    '.docx.vbs',
    '.docx.js',
  ];

  for (const ext of suspiciousDoubleExtensions) {
    if (lowerPath.endsWith(ext)) {
      log.error('Security: Suspicious double extension detected', { path: filePath, extension: ext });
      return false;
    }
  }

  // Check path length (Windows has 260 char limit by default)
  if (filePath.length > 260) {
    log.warn('Path exceeds maximum length (260 characters)', filePath.length);
    // This is a warning not error as some systems support longer paths
  }

  // Check for special Windows device names
  const windowsDeviceNames = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ];

  const fileName = filePath.split(/[\\/]/).pop()?.split('.')[0]?.toUpperCase();
  if (fileName && windowsDeviceNames.includes(fileName)) {
    log.error('Security: Windows device name detected', { path: filePath, deviceName: fileName });
    return false;
  }

  // Check for URL protocols that shouldn't be in file paths
  const dangerousProtocols = [
    'file://',
    'http://',
    'https://',
    'ftp://',
    'javascript:',
    'data:',
  ];

  for (const protocol of dangerousProtocols) {
    if (lowerPath.includes(protocol)) {
      log.error('Security: URL protocol in file path', { path: filePath, protocol });
      return false;
    }
  }

  // All checks passed
  log.debug('Path validation passed', filePath);
  return true;
}

/**
 * Sanitizes a file path by removing dangerous characters
 * Note: This should be used with caution as it modifies the path
 * @param filePath The path to sanitize
 * @returns Sanitized path or null if path is unsafe
 */
export function sanitizePath(filePath: string): string | null {
  if (!isPathSafe(filePath)) {
    return null;
  }

  // Additional sanitization could go here if needed
  // For now, we just return the validated path
  return filePath;
}

/**
 * Checks if a path is within an allowed directory
 * @param filePath The path to check
 * @param allowedPaths Array of allowed base directories
 * @returns true if path is within an allowed directory
 */
export function isPathWithinAllowed(filePath: string, allowedPaths: string[]): boolean {
  if (!filePath || allowedPaths.length === 0) {
    return false;
  }

  // Normalize the file path for comparison
  const normalizedFilePath = filePath.replace(/\\/g, '/').toLowerCase();

  // Check if file path starts with any allowed path
  return allowedPaths.some(allowed => {
    const normalizedAllowed = allowed.replace(/\\/g, '/').toLowerCase();
    return normalizedFilePath.startsWith(normalizedAllowed);
  });
}

/**
 * Validates a batch of file paths
 * @param filePaths Array of paths to validate
 * @param allowedExtensions Optional array of allowed extensions
 * @returns Object with valid and invalid paths
 */
export function validateBatchPaths(
  filePaths: string[],
  allowedExtensions?: string[]
): {
  valid: string[];
  invalid: { path: string; reason: string }[];
} {
  const valid: string[] = [];
  const invalid: { path: string; reason: string }[] = [];

  for (const path of filePaths) {
    if (isPathSafe(path, allowedExtensions)) {
      valid.push(path);
    } else {
      invalid.push({
        path,
        reason: 'Failed security validation'
      });
    }
  }

  log.info(`Batch validation complete: ${valid.length} valid, ${invalid.length} invalid`);
  return { valid, invalid };
}