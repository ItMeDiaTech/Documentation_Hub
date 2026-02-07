/**
 * Shared types for the BlankLineManager module.
 */

/**
 * Common options for blank paragraph creation and insertion
 */
export interface BlankLineOptions {
  /** Spacing after blank paragraphs in twips (default: 120 = 6pt) */
  spacingAfter: number;
  /** Mark blank paragraphs as preserved to prevent removal (default: true) */
  markAsPreserved: boolean;
  /** Style to apply to blank paragraphs (default: 'Normal') */
  style: string;
}

export const DEFAULT_BLANK_LINE_OPTIONS: BlankLineOptions = {
  spacingAfter: 120,
  markAsPreserved: true,
  style: "Normal",
};
