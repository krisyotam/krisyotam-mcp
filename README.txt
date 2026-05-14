krisyotam-mcp

A Model Context Protocol (MCP) server that gives AI assistants access to
krisyotam.com -- search writing, poetry, essays, prayers, and run queries
against the public data layer.

Built on the official @modelcontextprotocol/sdk. No API keys required. All data
is pulled live from krisyotam.com and data.krisyotam.com.


TOOLS

  Tool               Description
  ---------------    -----------------------------------------------------------
  search_all         Search everything on the site -- writing, poetry, essays, prayers
  search_content     Search Kris Yotam's writing (blog, essays, papers, fiction, verse,
                     reviews, progymnasmata, diary, docs, news)
  search_reference   Full-text search across the reference collection -- 3200+ poems,
                     essays, and prayers
  get_poem           Fetch the full text of a specific poem by path
  list_poets         List all poets in the collection with poem counts
  query_data         Run a read-only SQL query against the public Datasette instance
                     (databases: content, reference, media, system, lab)


SETUP

  Requirements: Node.js 18+

    git clone https://github.com/krisyotam/krisyotam-mcp.git
    cd krisyotam-mcp
    npm install
    npm run build


  Claude Code

    Add to ~/.claude/mcp.json:

      {
        "mcpServers": {
          "krisyotam": {
            "command": "node",
            "args": ["/absolute/path/to/krisyotam-mcp/dist/index.js"]
          }
        }
      }

    Restart Claude Code after saving.


  Cursor

    Add to .cursor/mcp.json in your project root (or ~/.cursor/mcp.json globally):

      {
        "mcpServers": {
          "krisyotam": {
            "command": "node",
            "args": ["/absolute/path/to/krisyotam-mcp/dist/index.js"]
          }
        }
      }

    Open Cursor Settings > MCP and verify the server appears. You may need to
    enable it manually.


  Windsurf

    Add to ~/.codeium/windsurf/mcp_config.json:

      {
        "mcpServers": {
          "krisyotam": {
            "command": "node",
            "args": ["/absolute/path/to/krisyotam-mcp/dist/index.js"]
          }
        }
      }

    Restart Windsurf after saving.


  Windows

    On Windows, wrap the command in cmd:

      {
        "mcpServers": {
          "krisyotam": {
            "command": "cmd",
            "args": ["/c", "node", "C:\\path\\to\\krisyotam-mcp\\dist\\index.js"]
          }
        }
      }

    Replace the path in all examples above with the actual path where you cloned
    the repo.


USAGE

  Once connected, your AI assistant can query the site automatically:

    - "What has Kris written about Baudelaire?"
    - "Find poems about mortality"
    - "Search for essays on stoicism"
    - "Get the full text of Keats's Ode to a Nightingale"
    - "List all poets in the collection"
    - "Query the content database for all papers published in 2025"


DATA

  All queries hit live APIs -- no local data or credentials required:

    krisyotam.com       Content and reference search endpoints
    data.krisyotam.com  Public Datasette instance for SQL queries


CONTRIBUTING

  This is a personal project. It is open for reference but not accepting contributions.


LICENSE

  MIT
