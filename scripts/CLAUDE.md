# Scripts Directory

This directory contains utility scripts for development, testing, and diagnostics.

## Directory Structure

```text
scripts/
  diagnostics/         # Diagnostic and analysis scripts
    analyze-test6.js         # JavaScript test analysis utility
    diagnose-before-tables.ts # TypeScript diagnostic for table processing
    diagnose-styles.ts       # Style analysis and debugging
    diagnose-tables.ts       # Table structure diagnostics
```

## Purpose

These scripts are development utilities that help with:

1. **Document Analysis**: Analyzing DOCX document structures and XML content
2. **Diagnostics**: Debugging document processing issues
3. **Testing**: Running isolated tests for specific document processing features
4. **Troubleshooting**: Investigating edge cases and processing failures

## Usage

These scripts are **not part of the production application**. They are:

- Used during development for debugging and analysis
- Run manually when investigating issues
- Not included in the built application
- Gitignored to keep them out of version control

## Note

The `diagnostics/` subdirectory is gitignored, so these scripts won't be committed to the repository. They remain local to each developer's workspace for troubleshooting purposes.
