#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const BASE = "https://krisyotam.com"
const DATA = "https://data.krisyotam.com"

const CONTENT_TABLES = [
  "blog", "essays", "papers", "fiction", "verse",
  "reviews", "progymnasmata", "diary", "ocs", "news", "documents",
]

async function dsQuery<T>(db: string, sql: string): Promise<T[]> {
  const url = `${DATA}/${db}.json?sql=${encodeURIComponent(sql)}&_shape=array`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Datasette ${res.status}: ${db} — ${sql.slice(0, 80)}`)
  return res.json() as Promise<T[]>
}

function fmt(type: string, title: string, category: string, url: string, preview?: string): string {
  const cat = category ? ` · ${category}` : ""
  const pre = preview ? `\n   ${preview.slice(0, 120)}` : ""
  return `[${type}${cat}] ${title}\n   ${url}${pre}`
}

const server = new McpServer({ name: "krisyotam", version: "1.0.0" })

// ── search_all ───────────────────────────────────────────────────────────────
server.tool(
  "search_all",
  "Search all content on krisyotam.com — writing, poetry, essays, prayers, and more.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const q = query.replace(/'/g, "''")

    // Content: UNION ALL across all content tables
    const contentUnion = CONTENT_TABLES.map(t =>
      `SELECT '${t}' AS type, slug, title, preview, category_slug FROM ${t}
       WHERE state='active' AND (title LIKE '%${q}%' OR preview LIKE '%${q}%' OR category_slug LIKE '%${q}%')`
    ).join(" UNION ALL ")

    const [contentRows, poemRows, essaiRows, prayerRows] = await Promise.all([
      dsQuery<{ type: string; slug: string; title: string; preview: string; category_slug: string }>(
        "content", `${contentUnion} LIMIT 20`
      ),
      dsQuery<{ slug: string; title: string; author_name: string; first_line: string; path: string }>(
        "reference",
        `SELECT slug, title, author_name, first_line, path FROM poems
         WHERE state='active' AND (title LIKE '%${q}%' OR author_name LIKE '%${q}%' OR text LIKE '%${q}%') LIMIT 15`
      ),
      dsQuery<{ slug: string; title: string; author_name: string; path: string }>(
        "reference",
        `SELECT slug, title, author_name, path FROM essais
         WHERE state='active' AND (title LIKE '%${q}%' OR author_name LIKE '%${q}%' OR text LIKE '%${q}%') LIMIT 10`
      ),
      dsQuery<{ slug: string; title: string; author_name: string; path: string }>(
        "reference",
        `SELECT slug, title, author_name, path FROM prayer
         WHERE state='active' AND (title LIKE '%${q}%' OR author_name LIKE '%${q}%' OR text LIKE '%${q}%') LIMIT 5`
      ),
    ])

    const lines: string[] = []
    for (const r of contentRows)
      lines.push(fmt(r.type, r.title, r.category_slug, `${BASE}/${r.slug}`, r.preview))
    for (const r of poemRows)
      lines.push(fmt("poem", r.title, r.author_name, `${BASE}/poetry/${r.path}`, r.first_line))
    for (const r of essaiRows)
      lines.push(fmt("essay", r.title, r.author_name, `${BASE}/essais/${r.path}`))
    for (const r of prayerRows)
      lines.push(fmt("prayer", r.title, r.author_name, `${BASE}/prayer/${r.path}`))

    if (!lines.length)
      return { content: [{ type: "text", text: `No results for "${query}".` }] }

    return { content: [{ type: "text", text: `${lines.length} results for "${query}":\n\n${lines.join("\n\n")}` }] }
  }
)

// ── search_content ───────────────────────────────────────────────────────────
server.tool(
  "search_content",
  "Search Kris Yotam's writing — blog posts, essays, papers, fiction, verse, reviews, and more.",
  {
    query: z.string().describe("Search query"),
    type: z.enum(["all", "blog", "essays", "papers", "fiction", "verse", "reviews", "progymnasmata", "diary", "ocs", "news", "documents"])
      .optional().describe("Filter by content type (default: all)"),
  },
  async ({ query, type = "all" }) => {
    const q = query.replace(/'/g, "''")
    const tables = type === "all" ? CONTENT_TABLES : [type]

    const union = tables.map(t =>
      `SELECT '${t}' AS type, slug, title, preview, category_slug, start_date FROM ${t}
       WHERE state='active' AND (title LIKE '%${q}%' OR preview LIKE '%${q}%' OR category_slug LIKE '%${q}%')`
    ).join(" UNION ALL ")

    const rows = await dsQuery<{ type: string; slug: string; title: string; preview: string; category_slug: string; start_date: string }>(
      "content", `${union} ORDER BY start_date DESC LIMIT 20`
    )

    if (!rows.length)
      return { content: [{ type: "text", text: `No results for "${query}".` }] }

    const lines = rows.map(r => fmt(r.type, r.title, r.category_slug, `${BASE}/${r.slug}`, r.preview))
    return { content: [{ type: "text", text: `${rows.length} results:\n\n${lines.join("\n\n")}` }] }
  }
)

// ── search_reference ─────────────────────────────────────────────────────────
server.tool(
  "search_reference",
  "Full-text search across the reference collection — 3200+ poems, essays, and prayers.",
  {
    query: z.string().describe("Search query — matches title, author, or full text"),
    type: z.enum(["all", "poems", "essais", "prayer"]).optional().describe("Filter by type (default: all)"),
  },
  async ({ query, type = "all" }) => {
    const q = query.replace(/'/g, "''")
    const tables = type === "all" ? ["poems", "essais", "prayer"] : [type]

    const lines: string[] = []

    for (const t of tables) {
      const route = t === "poems" ? "poetry" : t
      if (t === "poems") {
        const rows = await dsQuery<{ slug: string; title: string; author_name: string; first_line: string; path: string }>(
          "reference",
          `SELECT slug, title, author_name, first_line, path FROM poems
           WHERE state='active' AND (title LIKE '%${q}%' OR author_name LIKE '%${q}%' OR text LIKE '%${q}%') LIMIT 30`
        )
        for (const r of rows)
          lines.push(fmt("poem", r.title, r.author_name, `${BASE}/${route}/${r.path}`, r.first_line))
      } else {
        const rows = await dsQuery<{ slug: string; title: string; author_name: string; path: string; text: string }>(
          "reference",
          `SELECT slug, title, author_name, path, text FROM ${t}
           WHERE state='active' AND (title LIKE '%${q}%' OR author_name LIKE '%${q}%' OR text LIKE '%${q}%') LIMIT 20`
        )
        for (const r of rows)
          lines.push(fmt(t === "essais" ? "essay" : "prayer", r.title, r.author_name, `${BASE}/${route}/${r.path}`, r.text))
      }
    }

    if (!lines.length)
      return { content: [{ type: "text", text: `No results for "${query}".` }] }

    return { content: [{ type: "text", text: `${lines.length} results:\n\n${lines.join("\n\n")}` }] }
  }
)

// ── get_poem ─────────────────────────────────────────────────────────────────
server.tool(
  "get_poem",
  "Fetch the full text of a specific poem by its path (poet-slug/poem-slug).",
  { path: z.string().describe("Poem path, e.g. emily-dickinson/because-i-could-not-stop-for-death") },
  async ({ path }) => {
    const p = path.replace(/'/g, "''")
    const rows = await dsQuery<{ title: string; author_name: string; text: string }>(
      "reference",
      `SELECT title, author_name, text FROM poems WHERE path='${p}' LIMIT 1`
    )
    if (!rows.length)
      return { content: [{ type: "text", text: `No poem found at path: ${path}` }] }
    const { title, author_name, text } = rows[0]
    return { content: [{ type: "text", text: `${title}\n${author_name}\n\n${text}\n\n${BASE}/poetry/${path}` }] }
  }
)

// ── list_poets ───────────────────────────────────────────────────────────────
server.tool(
  "list_poets",
  "List all poets in the krisyotam.com poetry collection with poem counts.",
  {},
  async () => {
    const rows = await dsQuery<{ author_name: string; author_slug: string; count: number }>(
      "reference",
      "SELECT author_name, author_slug, COUNT(*) as count FROM poems GROUP BY author_slug ORDER BY count DESC"
    )
    if (!rows.length)
      return { content: [{ type: "text", text: "No poets found." }] }
    const lines = rows.map(r => `${r.author_name} (${r.count}) — ${BASE}/poetry/${r.author_slug}`)
    return { content: [{ type: "text", text: `${rows.length} poets:\n\n${lines.join("\n")}` }] }
  }
)

// ── query_data ───────────────────────────────────────────────────────────────
server.tool(
  "query_data",
  "Run a read-only SQL query against data.krisyotam.com. Available DBs: content, reference, media, system, lab.",
  {
    db: z.enum(["content", "reference", "media", "system", "lab"]).describe("Database to query"),
    sql: z.string().describe("SQL SELECT query"),
  },
  async ({ db, sql }) => {
    const rows = await dsQuery(db, sql)
    if (!rows.length)
      return { content: [{ type: "text", text: "No rows returned." }] }
    return { content: [{ type: "text", text: JSON.stringify(rows.slice(0, 50), null, 2) }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
