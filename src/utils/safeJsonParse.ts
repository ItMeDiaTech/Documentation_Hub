import { logger } from './logger';

/**
 * Safely parse JSON with error handling
 * Returns the parsed value or the default value if parsing fails
 */
export function safeJsonParse<T>(
  jsonString: string | null | undefined,
  defaultValue: T,
  context?: string
): T {
  if (!jsonString) {
    return defaultValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    const log = logger.namespace('SafeJsonParse');
    log.error(
      `Failed to parse JSON${context ? ` in ${context}` : ''}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    log.debug('Invalid JSON string:', jsonString.substring(0, 100));
    return defaultValue;
  }
}

/**
 * Safely stringify JSON with error handling
 * Returns null if stringification fails
 */
export function safeJsonStringify(
  value: unknown,
  space?: string | number,
  context?: string
): string | null {
  try {
    return JSON.stringify(value, null, space);
  } catch (error) {
    const log = logger.namespace('SafeJsonStringify');
    log.error(
      `Failed to stringify JSON${context ? ` in ${context}` : ''}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return null;
  }
}

/**
 * Type guard to check if a value is a valid JSON object
 */
export function isValidJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is a valid JSON array
 */
export function isValidJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}