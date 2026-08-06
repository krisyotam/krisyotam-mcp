#!/usr/bin/env node
/**
 * krisyotam-mcp — MCP server for krisyotam.com
 *
 * Reads live site data from the Postgres database (schemas: content,
 * reference, media, system, lab, interactions, storage, analytics).
 *
 * Requires DATABASE_URL, e.g.:
 *   postgresql://krisyotam:krisyotam@100.74.152.79:5434/krisyotam
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import postgres from "postgres"
import { z } from "zod"

const BASE = "https://krisyotam.com"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error("krisyotam-mcp: DATABASE_URL is required")
  process.exit(1)
}

const sql = postgres(DATABASE_URL, {
  max: 4,
  idle_timeout: 20,
  connect_timeout: 10,
})

/** Content tables with slug/title/preview/category_slug/start_date/state. */
const CONTENT_TABLES = [
  "blog",
  "essays",
  "papers",
  "fiction",
  "verse",
  "reviews",
  "progymnasmata",
  "diary",
  "ocs",
  "news",
] as const

type ContentTable = (typeof CONTENT_TABLES)[number]

const SCHEMAS = [
  "content",
  "reference",
  "media",
  "system",
  "lab",
  "interactions",
  "storage",
  "analytics",
] as const

type Schema = (typeof SCHEMAS)[number]

type ContentRow = {
  type: string
  slug: string
  title: string
  preview: string | null
  category_slug: string | null
  start_date?: string | null
}

type PoemRow = {
  slug: string
  title: string
  author_name: string
  first_line: string | null
  path: string
  text?: string | null
}

type RefRow = {
  slug: string
  title: string
  author_name: string
  path: string
  text?: string | null
}

function fmt(
  type: string,
  title: string,
  category: string | null | undefined,
  url: string,
  preview?: string | null,
): string {
  const cat = category ? ` · ${category}` : ""
  const pre = preview ? `\n   ${preview.slice(0, 120)}` : ""
  return `[${type}${cat}] ${title}\n   ${url}${pre}`
}

function isSelectOnly(query: string): boolean {
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
  if (!stripped) return false
  // Single statement only
  if (stripped.includes(";")) {
    const parts = stripped.split(";").map((p) => p.trim()).filter(Boolean)
    if (parts.length !== 1) return false
  }
  return /^(with\b|select\b)/i.test(stripped)
}

async function searchContentTables(
  pattern: string,
  tables: readonly ContentTable[],
  limit: number,
): Promise<ContentRow[]> {
  const perTable = Math.max(3, Math.ceil(limit / tables.length))
  const batches = await Promise.all(
    tables.map(async (table) => {
      // Table names are allowlisted constants — safe to interpolate.
      const rows = await sql.unsafe<ContentRow[]>(
        `SELECT '${table}' AS type, slug, title, preview, category_slug, start_date
         FROM content.${table}
         WHERE state = 'active'
           AND (
             title ILIKE $1
             OR COALESCE(preview, '') ILIKE $1
             OR COALESCE(category_slug, '') ILIKE $1
           )
         ORDER BY start_date DESC NULLS LAST
         LIMIT ${perTable}`,
        [pattern],
      )
      return [...rows]
    }),
  )
  return batches
    .flat()
    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
    .slice(0, limit)
}

const server = new McpServer({ name: "krisyotam", version: "2.0.0" })

// ── search_all ───────────────────────────────────────────────────────────────
server.tool(
  "search_all",
  "Search all content on krisyotam.com — writing, poetry, essays, prayers, and more.",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const pattern = `%${query}%`

    const [contentRows, poemRows, essaiRows, prayerRows] = await Promise.all([
      searchContentTables(pattern, CONTENT_TABLES, 20),
      sql<PoemRow[]>`
        SELECT slug, title, author_name, first_line, path
        FROM reference.poems
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR author_name ILIKE ${pattern}
            OR COALESCE(text, '') ILIKE ${pattern}
          )
        LIMIT 15
      `,
      sql<RefRow[]>`
        SELECT slug, title, author_name, path
        FROM reference.essais
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR author_name ILIKE ${pattern}
            OR COALESCE(text, '') ILIKE ${pattern}
          )
        LIMIT 10
      `,
      sql<RefRow[]>`
        SELECT slug, title, author_name, path
        FROM reference.prayer
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR author_name ILIKE ${pattern}
            OR COALESCE(text, '') ILIKE ${pattern}
          )
        LIMIT 5
      `,
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
      return { content: [{ type: "text" as const, text: `No results for "${query}".` }] }

    return {
      content: [
        {
          type: "text" as const,
          text: `${lines.length} results for "${query}":\n\n${lines.join("\n\n")}`,
        },
      ],
    }
  },
)

// ── search_content ───────────────────────────────────────────────────────────
server.tool(
  "search_content",
  "Search Kris Yotam's writing — blog posts, essays, papers, fiction, verse, reviews, and more.",
  {
    query: z.string().describe("Search query"),
    type: z
      .enum(["all", ...CONTENT_TABLES])
      .optional()
      .describe("Filter by content type (default: all)"),
  },
  async ({ query, type = "all" }) => {
    const pattern = `%${query}%`
    const tables: ContentTable[] =
      type === "all" ? [...CONTENT_TABLES] : [type as ContentTable]

    const rows = await searchContentTables(pattern, tables, 20)

    if (!rows.length)
      return { content: [{ type: "text" as const, text: `No results for "${query}".` }] }

    const lines = rows.map((r) =>
      fmt(r.type, r.title, r.category_slug, `${BASE}/${r.slug}`, r.preview),
    )
    return {
      content: [{ type: "text" as const, text: `${rows.length} results:\n\n${lines.join("\n\n")}` }],
    }
  },
)

// ── search_reference ─────────────────────────────────────────────────────────
server.tool(
  "search_reference",
  "Full-text search across the reference collection — 3200+ poems, essays, and prayers.",
  {
    query: z.string().describe("Search query — matches title, author, or full text"),
    type: z
      .enum(["all", "poems", "essais", "prayer"])
      .optional()
      .describe("Filter by type (default: all)"),
  },
  async ({ query, type = "all" }) => {
    const pattern = `%${query}%`
    const lines: string[] = []

    if (type === "all" || type === "poems") {
      const rows = await sql<PoemRow[]>`
        SELECT slug, title, author_name, first_line, path
        FROM reference.poems
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR author_name ILIKE ${pattern}
            OR COALESCE(text, '') ILIKE ${pattern}
          )
        LIMIT 30
      `
      for (const r of rows)
        lines.push(fmt("poem", r.title, r.author_name, `${BASE}/poetry/${r.path}`, r.first_line))
    }

    if (type === "all" || type === "essais") {
      const rows = await sql<RefRow[]>`
        SELECT slug, title, author_name, path, text
        FROM reference.essais
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR author_name ILIKE ${pattern}
            OR COALESCE(text, '') ILIKE ${pattern}
          )
        LIMIT 20
      `
      for (const r of rows)
        lines.push(
          fmt("essay", r.title, r.author_name, `${BASE}/essais/${r.path}`, r.text?.slice(0, 120)),
        )
    }

    if (type === "all" || type === "prayer") {
      const rows = await sql<RefRow[]>`
        SELECT slug, title, author_name, path, text
        FROM reference.prayer
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR author_name ILIKE ${pattern}
            OR COALESCE(text, '') ILIKE ${pattern}
          )
        LIMIT 20
      `
      for (const r of rows)
        lines.push(
          fmt("prayer", r.title, r.author_name, `${BASE}/prayer/${r.path}`, r.text?.slice(0, 120)),
        )
    }

    if (!lines.length)
      return { content: [{ type: "text" as const, text: `No results for "${query}".` }] }

    return {
      content: [
        { type: "text" as const, text: `${lines.length} results:\n\n${lines.join("\n\n")}` },
      ],
    }
  },
)

// ── get_poem ─────────────────────────────────────────────────────────────────
server.tool(
  "get_poem",
  "Fetch the full text of a specific poem by its path (poet-slug/poem-slug).",
  {
    path: z
      .string()
      .describe("Poem path, e.g. emily-dickinson/because-i-could-not-stop-for-death"),
  },
  async ({ path }) => {
    const rows = await sql<{ title: string; author_name: string; text: string | null }[]>`
      SELECT title, author_name, text
      FROM reference.poems
      WHERE path = ${path}
      LIMIT 1
    `
    if (!rows.length)
      return { content: [{ type: "text" as const, text: `No poem found at path: ${path}` }] }
    const { title, author_name, text } = rows[0]
    return {
      content: [
        {
          type: "text" as const,
          text: `${title}\n${author_name}\n\n${text ?? ""}\n\n${BASE}/poetry/${path}`,
        },
      ],
    }
  },
)

// ── list_poets ───────────────────────────────────────────────────────────────
server.tool(
  "list_poets",
  "List all poets in the krisyotam.com poetry collection with poem counts.",
  {},
  async () => {
    const rows = await sql<{ author_name: string; author_slug: string; count: string }[]>`
      SELECT author_name, author_slug, COUNT(*)::text AS count
      FROM reference.poems
      WHERE state = 'active'
      GROUP BY author_slug, author_name
      ORDER BY COUNT(*) DESC, author_name
    `
    if (!rows.length)
      return { content: [{ type: "text" as const, text: "No poets found." }] }
    const lines = rows.map(
      (r) => `${r.author_name} (${r.count}) — ${BASE}/poetry/${r.author_slug}`,
    )
    return {
      content: [
        { type: "text" as const, text: `${rows.length} poets:\n\n${lines.join("\n")}` },
      ],
    }
  },
)

// ── query_sql ────────────────────────────────────────────────────────────────
server.tool(
  "query_sql",
  "Run a read-only SQL SELECT against the krisyotam.com Postgres DB. Schemas: content, reference, media, system, lab, interactions, storage, analytics. Qualify tables (e.g. content.blog, reference.poems).",
  {
    sql: z.string().describe("SQL SELECT (or WITH … SELECT) query"),
    schema: z
      .enum(SCHEMAS)
      .optional()
      .describe("Optional search_path schema (default: content)"),
  },
  async ({ sql: query, schema = "content" }) => {
    if (!isSelectOnly(query)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Only single-statement SELECT / WITH queries are allowed.",
          },
        ],
      }
    }

    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO ${schema}, public`)
        await tx.unsafe("SET LOCAL default_transaction_read_only = on")
        return tx.unsafe(query)
      })

      if (!rows.length)
        return { content: [{ type: "text" as const, text: "No rows returned." }] }

      const limited = rows.slice(0, 50)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(limited, null, 2),
          },
        ],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: "text" as const, text: `Query error: ${message}` }],
      }
    }
  },
)

// Keep old name as alias so existing prompts still work
server.tool(
  "query_data",
  "Alias for query_sql. Run a read-only SQL SELECT. Prefer schema-qualified table names (content.blog, reference.poems). The db param sets search_path.",
  {
    db: z
      .enum(SCHEMAS)
      .optional()
      .describe("Schema for search_path (default: content)"),
    sql: z.string().describe("SQL SELECT query"),
  },
  async ({ db = "content", sql: query }) => {
    if (!isSelectOnly(query)) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Only single-statement SELECT / WITH queries are allowed.",
          },
        ],
      }
    }

    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO ${db}, public`)
        await tx.unsafe("SET LOCAL default_transaction_read_only = on")
        return tx.unsafe(query)
      })

      if (!rows.length)
        return { content: [{ type: "text" as const, text: "No rows returned." }] }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(rows.slice(0, 50), null, 2),
          },
        ],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: "text" as const, text: `Query error: ${message}` }],
      }
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
