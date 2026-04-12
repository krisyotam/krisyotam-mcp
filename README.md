# krisyotam-mcp

MCP server for [krisyotam.com](https://krisyotam.com). Gives Claude access to search across all content, docs, and references on the site.

## Tools

| Tool | Description |
|------|-------------|
| `search_all` | Search everything — writing, poetry, essays, prayers |
| `search_content` | Search writing only — blog, essays, papers, fiction, verse, reviews, TILs |
| `search_reference` | Full-text search across the reference collection (poems, essays, prayers) |
| `get_poem` | Fetch the full text of a specific poem by path |
| `list_poets` | List all poets in the collection with poem counts |
| `query_data` | Run a SQL query against the public Datasette instance at data.krisyotam.com |

## Installation

**Requirements:** Node.js 18+

```bash
git clone https://github.com/krisyotam/krisyotam-mcp.git
cd krisyotam-mcp
npm install
npm run build
```

## Configuration

Add the server to your Claude Code MCP config at `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "krisyotam": {
      "command": "node",
      "args": ["/absolute/path/to/krisyotam-mcp/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/krisyotam-mcp` with the actual path where you cloned the repo.

Restart Claude Code. The tools will be available in every session.

## Usage

Once installed, Claude can search the site automatically. Examples:

- "What has Kris written about Baudelaire?"
- "Find poems about mortality"
- "Search for essays on stoicism"
- "Get the full text of Keats's Ode to a Nightingale"
- "List all poets in the collection"
- "Query the content DB for all essays published in 2025"

## Data

All queries hit the live [krisyotam.com](https://krisyotam.com) APIs and [data.krisyotam.com](https://data.krisyotam.com) (Datasette). No local data required.
