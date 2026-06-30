/**
 * Maps raw processing error message(s) to a user-facing error category.
 *
 * Centralizes the classification that was previously duplicated (and divergent)
 * across the success-path finalizer and the exception catch in SessionContext.
 * The category drives the guidance shown in ErrorDetailsDialog.
 */
export type ProcessingErrorType = "file_locked" | "api_timeout" | "word_compatibility" | "general";

export function classifyProcessingError(messages: string[] | undefined): ProcessingErrorType {
  const text = (messages ?? []).join(" ").toLowerCase();

  if (text.includes("close the file")) {
    return "file_locked";
  }
  // Match BOTH "timeout" and "timed out": withTimeout()/processWithTimeout emit
  // "...timed out after Nms", which does not contain the substring "timeout".
  if (text.includes("timeout") || text.includes("timed out")) {
    return "api_timeout";
  }
  if (text.includes("compatibility_mode") || text.includes("outdated functions")) {
    return "word_compatibility";
  }
  return "general";
}
