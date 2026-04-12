#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const BASE = "https://krisyotam.com"
const DATA = "https://data.krisyotam.com"

interface SearchItem {
  title: string
  preview: string
  slug: string
  type: string
  category: string
  tags: string[]
  start_date: string
  url: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

function formatItem(item: SearchItem): string {
  const date = item.start_date ? ` (${item.start_date.slice(0, 10)})` : ""
  const preview = item.preview ? `\n   ${item.preview.slice(0, 120)}` : ""
  const cat = item.category ? ` · ${item.category}` : ""
  return `[${item.type}${cat}] ${item.title}${date}\n   ${BASE}${item.url}${preview}`
}

const server = new McpServer({
  name: "krisyotam",
  version: "1.0.0",
})

// ── search_all ───────────────────────────────────────────────────────────────
server.tool(
  "search_all",
  "Search all content on krisyotam.com — blog, essays, papers, fiction, verse, poetry, prayers, and more.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const [content, reference] = await Promise.all([
      fetchJson<SearchItem[]>(`${BASE}/api/content/search`),
      fetchJson<SearchItem[]>(`${BASE}/api/reference/search?q=${encodeURIComponent(query)}`),
    ])

    const q = query.toLowerCase()
    const contentMatches = content.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.preview?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q) ||
      item.tags?.some(t => t.toLowerCase().includes(q))
    )

    const all = [...contentMatches, ...reference]
    if (all.length === 0) return { content: [{ type: "text", text: `No results for "${query}".` }] }

    const out = all.slice(0, 20).map(formatItem).join("\n\n")
    return { content: [{ type: "text", text: `${all.length} results for "${query}":\n\n${out}` }] }
  }
)

// ── search_content ───────────────────────────────────────────────────────────
server.tool(
  "search_content",
  "Search Kris Yotam's writing — blog posts, essays, papers, fiction, verse, reviews, TILs, and diary entries.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const content = await fetchJson<SearchItem[]>(`${BASE}/api/content/search`)
    const q = query.toLowerCase()
    const matches = content.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.preview?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q) ||
      item.tags?.some(t => t.toLowerCase().includes(q))
    )

    if (matches.length === 0) return { content: [{ type: "text", text: `No results for "${query}".` }] }

    const out = matches.slice(0, 20).map(formatItem).join("\n\n")
    return { content: [{ type: "text", text: `${matches.length} results for "${query}":\n\n${out}` }] }
  }
)

// ── search_reference ─────────────────────────────────────────────────────────
server.tool(
  "search_reference",
  "Full-text search across Kris Yotam's reference collection — 3200+ poems, essays, and prayers. Searches poem body text.",
  {
    query: z.string().describe("Search query — can match poem text, title, or author"),
    type: z.enum(["all", "poems", "essais", "prayer"]).optional().describe("Filter by type (default: all)"),
  },
  async ({ query, type = "all" }) => {
    const items = await fetchJson<SearchItem[]>(
      `${BASE}/api/reference/search?q=${encodeURIComponent(query)}&type=${type}`
    )

    if (items.length === 0) return { content: [{ type: "text", text: `No results for "${query}".` }] }

    const out = items.map(formatItem).join("\n\n")
    return { content: [{ type: "text", text: `${items.length} results for "${query}":\n\n${out}` }] }
  }
)

// ── get_poem ─────────────────────────────────────────────────────────────────
server.tool(
  "get_poem",
  "Fetch the full text of a specific poem by its path (poet-slug/poem-slug).",
  { path: z.string().describe("Poem path, e.g. emily-dickinson/because-i-could-not-stop-for-death") },
  async ({ path }) => {
    try {
      const res = await fetch(`${BASE}/poetry/${path}`)
      if (!res.ok) throw new Error(`Not found: /poetry/${path}`)
      const html = await res.text()
      const match = html.match(/<pre>([\s\S]*?)<\/pre>/)
      const title = html.match(/<h1>(.*?)<\/h1>/)?.[1] ?? path
      const text = match ? match[1].trim() : "(text not available)"
      return { content: [{ type: "text", text: `${title}\n\n${text}\n\n${BASE}/poetry/${path}` }] }
    } catch (e) {
      return { content: [{ type: "text", text: `Could not fetch poem at /poetry/${path}` }] }
    }
  }
)

// ── list_poets ───────────────────────────────────────────────────────────────
server.tool(
  "list_poets",
  "List all poets in the krisyotam.com poetry collection with their poem counts.",
  {},
  async () => {
    const rows = await fetchJson<{ rows: [string, string, number][] }>(
      `${DATA}/reference/poems.json?sql=SELECT+author_slug,author_name,COUNT(*)+as+count+FROM+poems+GROUP+BY+author_slug+ORDER+BY+count+DESC&_shape=array`
    )

    if (!rows || !Array.isArray(rows)) {
      return { content: [{ type: "text", text: "Could not fetch poet list." }] }
    }

    const lines = (rows as unknown as Array<{ author_name: string; count: number; author_slug: string }>)
      .map(r => `${r.author_name} (${r.count} poems) — ${BASE}/poetry/${r.author_slug}`)
      .join("\n")

    return { content: [{ type: "text", text: `Poets in collection:\n\n${lines}` }] }
  }
)

// ── query_data ───────────────────────────────────────────────────────────────
server.tool(
  "query_data",
  "Run a read-only SQL query against krisyotam.com's public Datasette instance. Available DBs: content, reference, media, system, lab.",
  {
    db: z.enum(["content", "reference", "media", "system", "lab"]).describe("Database to query"),
    sql: z.string().describe("SQL SELECT query"),
  },
  async ({ db, sql }) => {
    const url = `${DATA}/${db}.json?sql=${encodeURIComponent(sql)}&_shape=array`
    try {
      const rows = await fetchJson<unknown[]>(url)
      if (!Array.isArray(rows) || rows.length === 0) {
        return { content: [{ type: "text", text: "No rows returned." }] }
      }
      const text = JSON.stringify(rows.slice(0, 50), null, 2)
      return { content: [{ type: "text", text: text }] }
    } catch (e) {
      return { content: [{ type: "text", text: `Query failed: ${e}` }] }
    }
  }
)

// ── run ──────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport()
await server.connect(transport)
