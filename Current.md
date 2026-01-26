# Documentation Hub - Current State

**Current Version:** 5.2.6
**docxmlater Framework:** 9.5.14
**Last Updated:** January 26, 2026

---

## Changes Since Version 5.0.11

This section documents all changes from version 5.0.11 to the current version 5.2.6, excluding any changes that were reverted.

### Version 5.0.12
- Fixed auto-update MSI error 2753 by showing installer UI during updates instead of silent installation

### Version 5.0.13
- Updated docxmlater framework from 9.2.x to 9.3.1

### Version 5.0.18
- Updated docxmlater framework from 9.3.1 to 9.4.0

### Version 5.2.0
- Updated docxmlater framework from 9.4.0 to 9.5.6
- Stabilized codebase by reverting experimental changes from versions 5.0.19 through 5.1.10

### Version 5.2.3
- Updated docxmlater framework from 9.5.6 to 9.5.7

### Version 5.2.4
- Updated docxmlater framework from 9.5.7 to 9.5.9

### Version 5.2.5
- Updated docxmlater framework from 9.5.9 to 9.5.13

### Version 5.2.6
- Added "Preserve Red (#FF0000) Font" processing option to preserve exact red font color on Normal style paragraphs
- Added "Power Automate Timeout" error handling with Retry button when API requests time out
- Fixed list continuation indentation so multiple consecutive indented paragraphs after a list item all receive the same indentation
- Updated docxmlater framework from 9.5.13 to 9.5.14

---

## Processing Options

The Processing Options tab allows you to configure which automated document processing operations are applied when documents are processed. Options are organized into four groups.

### Text Formatting Fixes

#### Remove All Italics
Removes italic formatting from all text throughout the document. This strips italic styling while preserving all other formatting such as bold, underline, and font settings.

#### Normalize Dashes to Hyphens
Replaces en-dashes and em-dashes with standard hyphens (-) throughout the document. This ensures consistent punctuation across the document, particularly useful for documents that may have inconsistent dash usage from different sources.

#### Preserve Red (#FF0000) Font
When enabled, preserves text with the exact hexadecimal color #FF0000 (pure red) on paragraphs styled as Normal. This prevents red-colored text from being overwritten when document styles are applied. This option only affects Normal style and List paragraphs; headers and list paragraphs are not affected. Default: Disabled.

#### Apply User Defined Styles
Applies the configured document styles (Heading 1, Heading 2, Heading 3, Normal) to paragraphs throughout the document based on their detected style. This ensures consistent typography according to the styles defined in the Styles tab.

---

### Hyperlink Fixes

#### Update Outdated Hyperlink Titles
Replaces outdated hyperlink display text based on custom replacement rules configured in the Replacements tab. Useful for updating legacy terminology or correcting hyperlink labels across documents.

#### Top of the Document
Creates "Return to Top" navigation links that allow readers to quickly jump back to the beginning of the document from various locations within the document.

#### Table of Contents
Rebuilds the Table of Contents with properly styled hyperlink entries that point to document headings. Creates a formatted, clickable TOC with consistent styling and navigation functionality.

#### Force Remove Heading 1 from TOC
When the Table of Contents option is enabled, this excludes Heading 1 entries from the generated TOC. Only Heading 2 and lower-level headings will appear in the Table of Contents.

#### theSource Hyperlinks
Validates and corrects internal hyperlinks by fixing their bookmark references. Ensures all internal navigation links point to valid destinations within the document.

#### theSource Content IDs
Appends Content IDs to theSource URLs using the PowerAutomate API integration. Extracts document identifiers from hyperlinks and adds them as URL fragments for proper API integration and tracking.

---

### Content Structure Fixes

#### Center and Border Images
Centers all images that are larger than 1 inch in either dimension and applies a 2-point black border around them. This provides visual emphasis and consistent image presentation throughout the document.

#### Remove Extra Whitespace
Collapses multiple consecutive spaces within text to single spaces. Cleans up documents that may have accumulated extra whitespace from copy-paste operations or manual formatting.

#### Remove Extra Blank Lines
Removes consecutive empty paragraphs (blank lines) to reduce document height and improve readability. Respects preservation options if enabled.

#### Preserve Previous User Set Blank Lines
When enabled, preserves single blank lines in the document and only removes consecutive duplicate blank lines (2 or more in a row). Useful when intentional blank lines have structural meaning that should be maintained. Default: Disabled.

#### Remove All Headers / Footers
Removes all header and footer content from every section of the document. Eliminates page numbers, running headers, company logos, and other header/footer elements.

#### Add Document Disclaimer
Adds a standardized warning or disclaimer message at the end of the document. Typically used to flag that the document has been processed or to include required legal/compliance notices.

#### Header 2 Section Tables
Validates and applies consistent formatting to table cells that are styled with Header 2. Ensures bold formatting, proper centering, and appropriate shading in Header 2 table cells for visual consistency.

---

### List & Table Fixes

#### List Indentation
Applies uniform list indentation across the document using the configured indentation levels. Sets specific positions for bullet symbols and text at each nesting level to ensure consistent list appearance.

#### List Styles
Standardizes bullet characters and numbered list formatting throughout the document. Ensures consistent symbols (such as filled circles, open circles, and squares) are used at each bullet level across all lists.

#### Table Formatting
Performs intelligent table detection and applies appropriate formatting based on table patterns. Handles different table types including 1x1 tables (often used for callout boxes), header rows, and data tables, applying optimal formatting for each type.

#### Adjust Table Padding
Applies custom cell padding values to table cells based on the configured settings. When enabled, standardizes the spacing within table cells. When disabled, tables retain their original padding values.
