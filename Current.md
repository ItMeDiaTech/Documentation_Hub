# Documentation Hub - Current State

**Current Version:** 5.2.35

---

## Changes Since Version 5.0.11

- Added "Preserve Red (#FF0000) Font" processing option to preserve exact red font color on Normal and List style paragraphs (Default: Disabled)
- Added "Power Automate Timeout" error handling with Retry button when API requests time out with explanation to user
- Fixed text indentation after lists so multiple consecutive indented paragraphs after a list item all receive the same indentation as the list item above it.
- Complete overhaul on the removal / adding of blank lines to accommodate much more situations and better align to formatting guidelines
	- Should no longer insert a blank line above keywords indented on the next line of list paragraphs, and will actually align them to the text of the list item above it
	- Added some checks for text that will better predict when a blank line is needed with regular text items
	- Will now also add a blank line above the High Level Process hyperlinks that links back to the High Level Process section. Also formatted them the same as the "Top of the Document" styled hyperlinks (right aligned, 0pt spacing after, hex color blue #0000FF, Verdana, 12pt size, underline, no bold or underline
- Added "Normalize Dashes to Hyphens" processing option to replace en-dashes and em-dashes with regular hyphens (Default: Enabled)
- Added "Table Cell Padding" to Styles section with appropriate defaults (0" Top, 0" Bottom, 0.08" Left, 0.08" Right). "Adjust Table Padding" processing option will update padding of tables when enabled. (Default: Enabled)
- Added "Standardize Cell Borders" processing option that sets the borders of all cells in every table to the color #000000 (Black) unless color is #FFC000 (High Level Process border color) in which case it won't change the color. It will then change the thickness of all borders of all cells of all tables to 1/2 pt (Word default, which is used in most if not all documents) with a dropdown menu in Styles to change this if needed.
- Updated "Add Document Disclaimer" text to "Add Document Disclaimer When Missing" to better align the name to what it is doing 
- Updated "Remove Extra Blank Lines" processing option text to "Standardize Blank Lines" as this is a better description of what it is doing

Other Changes:
- Added previously but quick reminder: If a document has an error during processing (shows a red "Error" next to the document), then double clicking this will provide a more thorough explanation as to what happened that can be provided to me for fixing.
- Although bullet symbols were correct in appearance, Word's default uses a different symbol that looks identical. Preferring to align exactly with Word, I updated the bullets accordingly. 
	- You should not notice this change.


Notes: 
	- Before every release, I test this application on around 100 documents (including documents provided to me that processed incorrectly previously) and run through 2,200+ tests.
	- You may need to click the "Reset" button within Processing Options for some of the new processing options to have their recommended enabled / disabled configuration shown.

---

## Processing Options

#### Remove All Italics
Removes italic formatting from all text throughout the document. This strips italic styling while preserving all other formatting such as bold, underline, and font settings.

#### Normalize Dashes to Hyphens
Replaces en-dashes and em-dashes with standard hyphens (-) throughout the document. This ensures consistent punctuation across the document.

#### Preserve Red (#FF0000) Font
When enabled, preserves text with the exact hexadecimal color #FF0000 (pure red) on paragraphs styled as Normal. This prevents red-colored text from being overwritten when document styles are applied. This option only affects Normal style and List paragraphs; headers and list paragraphs are not affected. Default: Disabled.

#### Apply User Defined Styles
Applies the configured document styles (Heading 1, Heading 2, Heading 3, Normal) to paragraphs throughout the document based on their detected style. This ensures consistent typography according to the styles defined in the Styles tab.

#### Update Outdated Hyperlink Titles
Replaces outdated hyperlink display text based on custom replacement rules configured in the Replacements tab. Useful for updating legacy or old titles.

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

#### Center and Border Images
Centers all images that are larger than 1 inch in either dimension and applies a 1-point black border around them but may be adjusted within Styles. 

#### Remove Extra Whitespace
Collapses multiple consecutive spaces within text to single spaces. Cleans up documents that may have accumulated extra whitespace from copy-paste operations or manual formatting.

#### Standardize Blank Lines
Removes consecutive empty paragraphs (blank lines) to reduce document height and improve readability. Respects preservation options if enabled.

#### Preserve Previous User Set Blank Lines
When enabled, preserves single blank lines in the document and only removes consecutive duplicate blank lines (2 or more in a row). Useful when intentional blank lines have structural meaning that should be maintained. (Default: Disabled).

#### Remove All Headers / Footers
Removes all header and footer content from every section of the document. Eliminates page numbers, running headers, company logos, and other header/footer elements.

#### Add Document Disclaimer When Missing
Adds a standardized warning or disclaimer message at the end of the document. Will not add one if one is already there.

#### Header 2 Section Tables
Validates and applies consistent formatting to table cells that are styled with Header 2. Ensures bold formatting and appropriate shading in Header 2 table cells for visual consistency.

#### List Indentation
Applies uniform list indentation across the document using the configured indentation levels. Sets specific positions for bullet symbols and text at each nesting level to ensure consistent list appearance. If something is improperly adjusted, there was likely an issue in the original document in how the document was created. 

#### List Styles
Standardizes bullet characters and numbered list formatting throughout the document. Ensures consistent symbols (such as filled circles, open circles, and squares) are used at each bullet level across all lists.

#### Table Formatting
Performs intelligent table detection and applies appropriate formatting based on table patterns. Handles different table types including 1x1 tables, header rows, and data tables, applying optimal formatting for each type.

#### Adjust Table Padding
Applies custom cell padding values to table cells based on the configured settings. When enabled, standardizes the spacing within table cells. When disabled, tables retain their original padding values.
