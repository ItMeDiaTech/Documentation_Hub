# MCP RAG Configuration for Documentation Hub

## Overview

This project is configured with **RAG (Retrieval-Augmented Generation)** capabilities through **MCP (Model Context Protocol)** servers. This enables Claude Code and other AI assistants to perform semantic code search, understand code relationships, and provide more accurate context-aware assistance.

## What is RAG?

**RAG** allows AI assistants to:
- Search your entire codebase semantically (meaning-based, not just keyword matching)
- Understand code relationships and dependencies
- Reduce token usage by ~40% compared to traditional grep-based search
- Provide more accurate and contextual responses

## Configuration File

The RAG configuration is stored in `.mcp.json` at the project root. This file is **committed to the repository** so all team members can benefit from the same RAG capabilities.

### Configured MCP Servers

#### 1. **Claude Context** (Enabled by Default)
- **Purpose**: Semantic code search with vector embeddings
- **Benefits**: 40% token reduction, hybrid search (BM25 + dense vectors)
- **Technology**: Uses Ollama for local embeddings, Milvus Lite for vector storage
- **Status**: ✅ Enabled

**What it does:**
- Indexes your TypeScript/React codebase
- Creates semantic embeddings of code chunks
- Enables natural language code search
- Provides relevant code context automatically

#### 2. **Code Graph RAG** (Disabled)
- **Purpose**: Graph-based understanding of code relationships
- **Benefits**: Understands dependencies, call graphs, import chains
- **Status**: ⏸️ Disabled (enable if needed)

#### 3. **Serena MCP** (Disabled)
- **Purpose**: Advanced semantic understanding via LSP (Language Server Protocol)
- **Benefits**: Most powerful for large codebases, uses actual language semantics
- **Status**: ⏸️ Disabled (requires Python uv installation)

## Installation & Setup

### Prerequisites

#### Required for Claude Context (Default)
1. **Ollama** (for local embedding models)
   ```bash
   # Install Ollama from https://ollama.ai
   # Then pull the embedding model:
   ollama pull nomic-embed-text
   ```

2. **Node.js/NPM** (already installed)
   - Claude Context uses npx to run

#### Optional for Serena MCP
3. **Python uv** (only if you want to enable Serena)
   ```bash
   # Install uv from https://docs.astral.sh/uv/
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

### Activation

#### Using Claude Code
```bash
# Initialize MCP servers (run once)
claude mcp install

# The servers are automatically activated based on .mcp.json
```

#### Manual Configuration
If you're using Claude Desktop app instead of Claude Code:
1. Locate your Claude config: `~/.config/claude/claude_desktop_config.json`
2. Add the MCP servers from `.mcp.json` to the config
3. Restart Claude Desktop

## Usage

### Semantic Code Search

Once configured, you can ask Claude questions that leverage RAG:

**Examples:**
```
"Find all authentication logic in the codebase"
"Show me how hyperlinks are processed"
"What components use the SessionContext?"
"Find where we handle document processing errors"
"Show me all the places where we interact with IndexedDB"
```

### Traditional vs RAG Search

**Traditional (Grep-based):**
- "Find files containing 'SessionContext'"
- Returns keyword matches only
- High token usage (sends lots of code to Claude)

**RAG-enabled (Semantic):**
- "Find components that manage user sessions"
- Understands meaning and context
- Returns relevant code based on semantic similarity
- 40% less token usage

## File Structure

```
Documentation_Hub/
├── .mcp.json                  # MCP server configuration (committed)
├── .mcp-cache/               # Vector DB and cache (ignored)
│   ├── claude-context/       # Claude Context storage
│   └── vector-db/            # Milvus Lite database
├── .serena/                  # Serena memories (ignored, if enabled)
└── MCP_RAG_SETUP.md         # This file
```

## Indexing Configuration

The RAG system indexes these files:
- `src/**/*.{ts,tsx,js,jsx}` - All TypeScript/React source code
- `electron/**/*.ts` - Electron main process code
- `docs/**/*.md` - Documentation
- `*.md` - Root-level markdown files

**Excluded from indexing:**
- `node_modules/` - Dependencies
- `dist/`, `dist-electron/`, `release/` - Build outputs
- `coverage/` - Test coverage reports
- `*.log`, `*.docx` - Log and binary files
- `.git/` - Git metadata

## Enabling/Disabling Servers

Edit `.mcp.json` and change the `disabled` flag:

```json
"code-graph-rag": {
  "disabled": false,  // Change to false to enable
  ...
}
```

Then restart Claude Code or run:
```bash
claude mcp reload
```

## Troubleshooting

### "MCP server not found"
- Ensure Node.js and npx are installed
- Run `claude mcp install` to initialize servers

### "Embedding model not found"
- Install Ollama: https://ollama.ai
- Pull the model: `ollama pull nomic-embed-text`

### "High token usage"
- RAG reduces token usage automatically
- Ensure Claude Context is enabled (check `"disabled": false`)
- Check that Ollama is running: `ollama list`

### "Slow indexing"
- First-time indexing takes a few minutes
- Subsequent searches are much faster
- Cache is stored in `.mcp-cache/` (excluded from git)

## Performance Benefits

With RAG enabled:
- **~40% token reduction** compared to grep-only search
- **Semantic understanding** of code, not just keyword matching
- **Faster responses** due to targeted context retrieval
- **Better accuracy** from understanding code relationships

## Team Benefits

Since `.mcp.json` is committed:
- ✅ **Consistent experience** across all team members
- ✅ **No manual configuration** needed per developer
- ✅ **Shared semantic understanding** of the codebase
- ✅ **Better AI assistance** for everyone

## Security & Privacy

- **All processing is local** (Ollama runs on your machine)
- **No code sent to external services** for embeddings
- **Vector database is local** (.mcp-cache/ is gitignored)
- **Cache is per-developer** (not shared via git)

## Advanced Configuration

### Custom Embedding Models

Edit `.mcp.json` to change the embedding model:
```json
"embeddingModel": {
  "provider": "ollama",
  "model": "all-minilm",  // Faster but less accurate
  "dimensions": 384
}
```

**Model options:**
- `nomic-embed-text` (768 dims) - Best quality, slower
- `all-minilm` (384 dims) - Faster, good quality
- `mxbai-embed-large` (1024 dims) - Highest quality, slowest

### Using OpenAI/VoyageAI Embeddings

If you prefer cloud-based embeddings:
```json
"claude-context": {
  "args": [
    "--embedding-provider", "openai",
    "--openai-api-key", "your-api-key"
  ]
}
```

## References

- **MCP Documentation**: https://modelcontextprotocol.io
- **Claude Context**: https://github.com/zilliztech/claude-context
- **Serena MCP**: https://github.com/oraios/serena
- **Ollama**: https://ollama.ai

## Support

For issues or questions:
1. Check this documentation
2. Review `.mcp.json` configuration
3. Check Claude Code logs: `claude logs`
4. File an issue on GitHub

---

**Last Updated**: 2025-11-13
**Configuration Version**: 1.0.0
**Compatible with**: Claude Code, Claude Desktop
