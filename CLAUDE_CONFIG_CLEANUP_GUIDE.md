# Claude Desktop Configuration Cleanup Guide

## Location

The Claude Desktop configuration file is typically located at:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

Or on Windows:

```text
C:\Users\DiaTech\AppData\Roaming\Claude\claude_desktop_config.json
```

## Issues to Fix

Based on the MCP_ERRORS_FIXED.md, the following servers need to be removed or fixed from your Claude Desktop configuration:

### 1. Remove: `@zilliztech/claude-context`

**Issue**: This npm package doesn't exist (404 error)
**Action**: Remove this entire server configuration block

### 2. Remove or Fix: `user-code-graph-rag`

**Issue**: JSON parsing errors and logging issues
**Action**: Either fix the configuration or remove this server entry

### 3. Remove: `user-dt-cli-rag-naf`

**Issue**: Python module path issues, appears to be a duplicate of `dt-cli-rag-maf`
**Action**: Remove this entry (the correct one is in your project's `.mcp.json`)

### 4. Fix or Remove: `user-serena`

**Issue**: Log formatting issues (lines being broken up)
**Action**: Fix log formatting in server implementation or remove if not needed

## How to Edit

1. Open File Explorer and navigate to:

   ```text
   C:\Users\DiaTech\AppData\Roaming\Claude
   ```

2. Open `claude_desktop_config.json` with a text editor (Notepad, VS Code, etc.)

3. Look for the server entries mentioned above in the `mcpServers` section

4. Remove or fix the problematic entries

5. Save the file

6. Restart Claude Desktop for changes to take effect

## Example Structure

Your Claude Desktop config should look something like this (without the problematic servers):

```json
{
  "mcpServers": {
    "valid-server-1": {
      "command": "...",
      "args": [...],
      "disabled": false
    }
  }
}
```

Make sure to:

- Keep valid JSON syntax (proper commas, brackets, quotes)
- Remove trailing commas if removing the last server in a section
- Validate JSON syntax before saving

## After Cleanup

Once you've cleaned up the configuration:

1. Restart Claude Desktop
2. Check that the MCP server errors are gone
3. The servers in your project's `.mcp.json` should continue working normally
