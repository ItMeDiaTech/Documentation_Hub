# Documentation Hub - Technical Documentation

This directory contains all technical documentation for the Documentation Hub application.

## Directory Structure

```
docs/
├── architecture/         # System architecture and design documents
│   ├── OOXML_HYPERLINK_ARCHITECTURE.md
│   └── docxmlater-functions-and-structure.md
│
├── implementation/       # Implementation guides and summaries
│   ├── Implementation reports
│   ├── Feature plans
│   └── Refactoring summaries
│
├── research/            # Research notes and analysis
│   ├── DOCXMLATER_ANALYSIS.md
│   ├── DOCXMLATER_EXAMPLES.md
│   └── Issue analysis documents
│
└── github-issues/       # GitHub issue documentation and tracking
    ├── fix-github-issue.md (template)
    └── Issue-specific research
```

## Document Categories

### Architecture Documents
High-level system design, architecture decisions, and technical specifications.

### Implementation Guides
Step-by-step implementation plans, feature specifications, and refactoring guides.

### Research Notes
Analysis documents, proof-of-concepts, and technical investigations.

### GitHub Issues
Issue templates, tracking documents, and issue-specific research.

## Personal vs Public Documentation

**Public Documentation** (tracked in git):
- Architecture diagrams and specifications
- Implementation guides
- API documentation
- User guides
- Contributing guidelines

**Personal Documentation** (gitignored):
- CLAUDE.md files (AI assistant context)
- TODO.md, NOTES.md, SCRATCH.md
- Personal status tracking
- Developer-specific workspace files

See `.gitignore` for complete list of excluded personal files.

## Contributing

When adding new documentation:
1. Place in appropriate subdirectory
2. Use descriptive filenames (e.g., `FEATURE_NAME_implementation.md`)
3. Include date if time-sensitive (e.g., `analysis-2025-10-19.md`)
4. Update this README if adding new categories

## Maintenance

This documentation structure was created on 2025-10-19 to organize scattered markdown files and separate personal workspace files from public documentation.
