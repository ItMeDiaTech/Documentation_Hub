/**
 * Pure functions for checking paragraph content characteristics.
 * Ported from docxmlater Document.ts private methods.
 * Most operate only on Paragraph/Run/etc. instances with no Document dependency.
 * Exception: getEffectiveLeftIndent() requires Document to resolve style-inherited indentation.
 */

import {
  Document,
  Paragraph,
  Run,
  Hyperlink,
  ImageRun,
  Shape,
  TextBox,
  Field,
  Revision,
} from "docxmlater";

/**
 * Checks if a paragraph is blank (no meaningful content).
 * Ported from Document.ts:8146-8215
 */
export function isParagraphBlank(para: Paragraph): boolean {
  const content = para.getContent();

  // No content at all
  if (!content || content.length === 0) {
    return true;
  }

  // Check all content items
  for (const item of content) {
    // Hyperlinks count as content
    if (item instanceof Hyperlink) {
      return false;
    }

    // ImageRun (images embedded in runs) count as content
    // IMPORTANT: Check ImageRun BEFORE Run since ImageRun extends Run
    if (item instanceof ImageRun) {
      return false;
    }

    // Shapes count as content
    if (item instanceof Shape) {
      return false;
    }

    // TextBox count as content
    if (item instanceof TextBox) {
      return false;
    }

    // Fields count as content
    if (item instanceof Field) {
      return false;
    }

    // Revisions (track changes) - check nested content for text and hyperlinks
    if (item instanceof Revision) {
      const revisionText = item.getText().trim();
      if (revisionText !== "") {
        return false;
      }
      // Also check if revision contains hyperlinks (may have empty display text)
      for (const revContent of item.getContent()) {
        if (revContent instanceof Hyperlink) {
          return false;
        }
      }
      continue; // Already checked, move to next item
    }

    // Check runs for non-whitespace text
    if ((item as any).getText) {
      const text = (item as any).getText().trim();
      if (text !== "") {
        return false;
      }
    }
  }

  // Check for bookmarks
  if (
    para.getBookmarksStart().length > 0 ||
    para.getBookmarksEnd().length > 0
  ) {
    return false;
  }

  return true;
}

/**
 * Checks if a paragraph starts with bold text and has a colon within the first 55 characters.
 * Examples: "Note:", "Warning:", "Note: This can include the following:"
 * Ported from Document.ts:8267-8287
 */
export function startsWithBoldColon(para: Paragraph): boolean {
  const content = para.getContent();
  if (!content || content.length === 0) return false;

  // Get first content item that is a Run (skip any non-Run items at start)
  const firstRun = content.find((item) => item instanceof Run) as
    | Run
    | undefined;
  if (!firstRun) return false;

  // Check if first run is bold
  const formatting = firstRun.getFormatting();
  if (!formatting.bold) return false;

  // Check if colon exists within first 55 characters of paragraph text
  const fullText = para.getText();
  if (!fullText) return false;

  const first55 = fullText.substring(0, 55);
  return first55.includes(":");
}

/**
 * Checks if a paragraph is centered bold text (all text runs are bold and centered).
 * Ported from Document.ts:8499-8523
 */
export function isCenteredBoldText(para: Paragraph): boolean {
  if (para.getAlignment() !== "center") return false;

  const content = para.getContent();
  if (!content || content.length === 0) return false;

  let hasTextRun = false;

  for (const item of content) {
    if (item instanceof Run) {
      const text = item.getText();
      if (text && text.trim() !== "") {
        hasTextRun = true;
        const formatting = item.getFormatting();
        if (!formatting.bold) return false;
      }
    }
  }

  return hasTextRun;
}

/**
 * Checks if a paragraph contains text but no media elements (images, shapes, textboxes).
 * Ported from Document.ts:8531-8548
 */
export function isTextOnlyParagraph(para: Paragraph): boolean {
  if (isParagraphBlank(para)) return false;

  const content = para.getContent();
  for (const item of content) {
    if (item instanceof ImageRun) return false;
    if (item instanceof Shape) return false;
    if (item instanceof TextBox) return false;
  }

  const text = para.getText();
  return !!text && text.trim() !== "";
}

/**
 * Detects Table of Contents paragraphs by style.
 * Ported from Document.ts:8397-8401
 */
export function isTocParagraph(para: Paragraph): boolean {
  const styleId = para.getStyle();
  if (!styleId) return false;
  const lower = styleId.toLowerCase();
  return /^toc\s?\d$/i.test(lower) || lower.startsWith("toc");
}

/**
 * Get the effective left indentation of a paragraph, resolving style-inherited
 * indentation when the paragraph has no direct indentation set.
 *
 * In OOXML, a paragraph's visual indentation can come from:
 * 1. Direct paragraph properties (<w:pPr><w:ind w:left="..."/>)
 * 2. The paragraph's style definition (e.g., ListParagraph defines w:left="720")
 *
 * Paragraph.getFormatting()?.indentation?.left only returns (1).
 * This helper also checks (2) via the Document's style definitions.
 *
 * NOTE: docxmlater currently parses style-level indentation as an empty object
 * (keys exist but values are undefined), so we also check for known indented
 * styles like ListParagraph which defines w:ind w:left="720" in its XML.
 */
export function getEffectiveLeftIndent(para: Paragraph, doc: Document): number {
  // 1. Check direct paragraph indentation
  const directIndent = para.getFormatting()?.indentation?.left;
  if (directIndent && directIndent > 0) return directIndent;

  // 2. Check style-inherited indentation
  const styleId = para.getStyle();
  if (styleId) {
    const style = doc.getStyle(styleId);
    if (style) {
      const stylePf = style.getParagraphFormatting();
      const styleIndent = stylePf?.indentation?.left;
      if (styleIndent && styleIndent > 0) return styleIndent;

      // Fallback: docxmlater may create an indentation object with undefined values
      // for styles that DO have w:ind in their XML (e.g., ListParagraph w:left="720").
      // If the style has an indentation object at all, it likely defines indentation.
      // ListParagraph is the most common case: Word's built-in style with w:left="720".
      if (stylePf?.indentation && styleId === "ListParagraph") {
        return 720; // Standard ListParagraph indentation
      }
    }
  }

  return 0;
}
