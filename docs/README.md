# Documentation Hub - Technical Documentation

This directory contains all technical documentation for the Documentation Hub application.

## Directory Structure

```
docs/
├── analysis/            # Bug analysis and technical investigations
│   ├── Bug fix summaries
│   ├── Implementation analyses
│   ├── Document processing issue reports
│   └── Performance and accuracy reports
│
├── api/                 # API documentation
│   ├── API_README.md
│   ├── API_REFERENCE.md
│   └── TYPE_DEFINITIONS.md
│
├── architecture/        # System architecture and design documents
│   ├── Complete processing flow diagrams
│   ├── Integration guides
│   ├── OOXML architecture specifications
│   └── Font embedding guides
│
├── fixes/              # Bug fix documentation
│   ├── Detailed fix summaries
│   ├── SDT and table protection fixes
│   ├── Corruption and spacing fixes
│   └── README with fix index
│
├── github-issues/      # GitHub issue documentation and tracking
│   ├── Issue body templates (issue-1-body.md through issue-10-body.md)
│   ├── Issue tracker and management
│   └── Predictive analysis documents
│
├── hooks/              # Development hooks documentation
│   └── README.md
│
├── implementation/     # Implementation guides and summaries
│   ├── Feature implementation plans
│   ├── Refactoring summaries
│   ├── Session management guides
│   ├── Plugin marketplace plans
│   └── Migration summaries
│
├── research/           # Research notes and analysis
│   ├── DOCXMLATER analysis and examples
│   ├── GitHub issue analysis
│   └── Code location documentation
│
├── versions/           # Version history
│   └── changelog.md
│
├── docxmlater-readme.md    # Third-party library documentation
├── DEBUG_LOGGING_GUIDE.md  # Debug logging instructions
├── README.md               # This file
└── TOC_WIRING_GUIDE.md     # Table of Contents implementation guide
```

## Document Categories

### Analysis Documents
Bug analyses, technical investigations, implementation accuracy reports, and processing issue documentation.

### API Documentation
Complete API reference, type definitions, and usage guides for developers.

### Architecture Documents
High-level system design, architecture decisions, technical specifications, and integration guides.

### Bug Fixes
Detailed documentation of bug fixes, including corruption fixes, protection fixes, and spacing corrections.

### GitHub Issues
Issue templates, tracking documents, and issue-specific research for GitHub issue management.

### Implementation Guides
Step-by-step implementation plans, feature specifications, refactoring guides, and migration summaries.

### Research Notes
Analysis documents, proof-of-concepts, technical investigations, and third-party library research.

### Version History
Changelog and version-specific documentation.

## Personal vs Public Documentation

**Public Documentation** (tracked in git):
- Architecture diagrams and specifications
- Implementation guides
- API documentation
- User guides
- Contributing guidelines

**Personal Documentation** (gitignored):
- TODO.md, NOTES.md, SCRATCH.md
- Personal status tracking
- Developer-specific workspace files

See `.gitignore` for complete list of excluded personal files.

## Documentation Standards

When adding new documentation:
1. Place in appropriate subdirectory based on content type
2. Use descriptive filenames with context (e.g., `FEATURE_NAME_implementation.md`)
3. Include dates for time-sensitive documents (e.g., `analysis-2025-10-19.md`)
4. Update this README if adding new categories or major documents
5. Keep technical documentation separate from user-facing guides (see root `/USER_GUIDE.md`)

## Maintenance History

- **2025-10-19**: Initial documentation structure created to organize scattered markdown files
- **2025-11-25**: Major cleanup - removed duplicate user guides, reorganized analysis/implementation files, moved test files to scripts/, removed personal workspace files from root
