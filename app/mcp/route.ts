import { createMcpHandler } from "mcp-handler";
import postgres from "postgres";
import { z } from "zod";

export const runtime = "nodejs";

const BASE_URL = "https://krisyotam.com";

const CONTENT_TABLES = [
  "blog",
  "essays",
  "papers",
  "prayers",
  "fiction",
  "verse",
  "reviews",
  "progymnasmata",
  "diary",
  "ocs",
  "news",
] as const;

const SPECIAL_CONTENT_TYPES = [
  "sequences",
  "documents",
  "prompts",
  "notebooks",
  "til",
] as const;

const ALL_CONTENT_TYPES = [...CONTENT_TABLES, ...SPECIAL_CONTENT_TYPES] as const;

type ContentTable = (typeof CONTENT_TABLES)[number];
type SpecialContentType = (typeof SPECIAL_CONTENT_TYPES)[number];
type ContentType = (typeof ALL_CONTENT_TYPES)[number];

type ContentRow = {
  type: string;
  slug: string;
  title: string;
  preview: string | null;
  category_slug: string | null;
  start_date: string | null;
  body?: string | null;
};

type PoemRow = {
  slug: string;
  title: string;
  author_name: string;
  first_line: string | null;
  path: string;
  text?: string | null;
};

type ReferenceRow = {
  slug: string;
  title: string;
  author_name: string;
  path: string;
  text?: string | null;
};

let database: ReturnType<typeof postgres> | undefined;

function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  database ??= postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return database;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function formatResult(
  type: string,
  title: string,
  category: string | null | undefined,
  url: string,
  preview?: string | null,
) {
  const categoryText = category ? ` | ${category}` : "";
  const previewText = preview ? `\n   ${preview.slice(0, 120)}` : "";
  return `[${type}${categoryText}] ${title}\n   ${url}${previewText}`;
}

function contentUrl(type: ContentType | string, slug: string) {
  if (type === "documents") return `${BASE_URL}/documents/${slug}`;
  if (type === "prompts") return `${BASE_URL}/prompts/${slug}`;
  if (type === "notebooks") return `${BASE_URL}/notebooks/${slug}`;
  if (type === "til") return `${BASE_URL}/til/${slug}`;
  if (type === "sequences") return `${BASE_URL}/sequences/${slug}`;
  return `${BASE_URL}/${slug}`;
}

async function searchContentTables(
  pattern: string,
  tables: readonly ContentTable[],
  limit: number,
) {
  const sql = getDatabase();
  const perTable = Math.max(3, Math.ceil(limit / tables.length));
  const batches = await Promise.all(
    tables.map(async (table) => {
      const rows = await sql.unsafe<ContentRow[]>(
        `SELECT '${table}' AS type, slug, title, preview, category_slug, start_date
         FROM content.${table}
         WHERE state = 'active'
           AND (
             title ILIKE $1
             OR COALESCE(preview, '') ILIKE $1
             OR COALESCE(category_slug, '') ILIKE $1
             OR COALESCE(body, '') ILIKE $1
           )
         ORDER BY start_date DESC NULLS LAST
         LIMIT ${perTable}`,
        [pattern],
      );
      return [...rows];
    }),
  );

  return batches
    .flat()
    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
    .slice(0, limit);
}

async function searchSpecialContent(
  pattern: string,
  type: SpecialContentType | "all",
  limit: number,
) {
  const sql = getDatabase();
  const searches: Promise<ContentRow[]>[] = [];

  if (type === "all" || type === "sequences") {
    searches.push(
      sql<ContentRow[]>`
        SELECT 'sequences' AS type, slug, title, preview, category_slug, start_date
        FROM content.sequences
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR COALESCE(preview, '') ILIKE ${pattern}
            OR COALESCE(category_slug, '') ILIKE ${pattern}
          )
        ORDER BY start_date DESC NULLS LAST
        LIMIT ${limit}
      `,
    );
  }

  if (type === "all" || type === "documents") {
    searches.push(
      sql<ContentRow[]>`
        SELECT 'documents' AS type, slug, title, abstract AS preview,
               topic_path AS category_slug, date AS start_date
        FROM content.documents
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR COALESCE(abstract, '') ILIKE ${pattern}
            OR COALESCE(annotation, '') ILIKE ${pattern}
            OR COALESCE(author, '') ILIKE ${pattern}
            OR COALESCE(topic_path, '') ILIKE ${pattern}
          )
        ORDER BY date DESC NULLS LAST
        LIMIT ${limit}
      `,
    );
  }

  if (type === "all" || type === "prompts") {
    searches.push(
      sql<ContentRow[]>`
        SELECT 'prompts' AS type, slug, title, description AS preview,
               category AS category_slug, date AS start_date
        FROM content.prompts
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR COALESCE(description, '') ILIKE ${pattern}
            OR COALESCE(model, '') ILIKE ${pattern}
            OR COALESCE(category, '') ILIKE ${pattern}
          )
        ORDER BY date DESC NULLS LAST
        LIMIT ${limit}
      `,
    );
  }

  if (type === "all" || type === "notebooks") {
    searches.push(
      sql<ContentRow[]>`
        SELECT 'notebooks' AS type, slug, title, NULL::text AS preview,
               NULL::text AS category_slug, created AS start_date
        FROM content.notebooks
        WHERE state = 'active' AND title ILIKE ${pattern}
        ORDER BY created DESC NULLS LAST
        LIMIT ${limit}
      `,
    );
  }

  if (type === "all" || type === "til") {
    searches.push(
      sql<ContentRow[]>`
        SELECT 'til' AS type, slug, title, preview,
               category AS category_slug, date AS start_date
        FROM system.til
        WHERE state = 'active'
          AND (
            title ILIKE ${pattern}
            OR COALESCE(preview, '') ILIKE ${pattern}
            OR COALESCE(category, '') ILIKE ${pattern}
          )
        ORDER BY date DESC NULLS LAST
        LIMIT ${limit}
      `,
    );
  }

  return (await Promise.all(searches))
    .flat()
    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
    .slice(0, limit);
}

async function searchPublishedContent(
  pattern: string,
  type: ContentType | "all",
  limit: number,
) {
  const standard = type === "all" || CONTENT_TABLES.includes(type as ContentTable)
    ? searchContentTables(
        pattern,
        type === "all" ? CONTENT_TABLES : [type as ContentTable],
        limit,
      )
    : Promise.resolve([]);
  const special = type === "all" || SPECIAL_CONTENT_TYPES.includes(type as SpecialContentType)
    ? searchSpecialContent(pattern, type as SpecialContentType | "all", limit)
    : Promise.resolve([]);

  const [standardRows, specialRows] = await Promise.all([standard, special]);
  return [...standardRows, ...specialRows]
    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""))
    .slice(0, limit);
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const handler = createMcpHandler((server) => {
  server.registerTool(
    "search_all",
    {
      title: "Search all krisyotam.com content",
      description: "Search every published site content type plus poetry, reference essays, and prayers.",
      inputSchema: z.object({ query: z.string().min(1).max(200) }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ query }) => {
      const sql = getDatabase();
      const pattern = `%${query}%`;
      const [contentRows, poemRows, essayRows, prayerRows] = await Promise.all([
        searchPublishedContent(pattern, "all", 30),
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
        sql<ReferenceRow[]>`
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
        sql<ReferenceRow[]>`
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
      ]);

      const lines: string[] = [];
      for (const row of contentRows) {
        lines.push(
          formatResult(
            row.type,
            row.title,
            row.category_slug,
            contentUrl(row.type, row.slug),
            row.preview,
          ),
        );
      }
      for (const row of poemRows) {
        lines.push(
          formatResult(
            "poem",
            row.title,
            row.author_name,
            `${BASE_URL}/poetry/${row.path}`,
            row.first_line,
          ),
        );
      }
      for (const row of essayRows) {
        lines.push(
          formatResult("essay", row.title, row.author_name, `${BASE_URL}/essais/${row.path}`),
        );
      }
      for (const row of prayerRows) {
        lines.push(
          formatResult("prayer", row.title, row.author_name, `${BASE_URL}/prayer/${row.path}`),
        );
      }

      return lines.length === 0
        ? textResult(`No results for "${query}".`)
        : textResult(`${lines.length} results for "${query}":\n\n${lines.join("\n\n")}`);
    },
  );

  server.registerTool(
    "search_content",
    {
      title: "Search Kris Yotam's writing",
      description: "Search all published authored and indexed content, including documents, prompts, notebooks, sequences, and TIL entries.",
      inputSchema: z
        .object({
          query: z.string().min(1).max(200),
          type: z.enum(["all", ...ALL_CONTENT_TYPES]).optional().default("all"),
          limit: z.number().int().min(1).max(100).optional().default(30),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ query, type, limit }) => {
      const rows = await searchPublishedContent(`%${query}%`, type, limit);
      if (rows.length === 0) return textResult(`No results for "${query}".`);

      const lines = rows.map((row) =>
        formatResult(
          row.type,
          row.title,
          row.category_slug,
          contentUrl(row.type, row.slug),
          row.preview,
        ),
      );
      return textResult(`${rows.length} results:\n\n${lines.join("\n\n")}`);
    },
  );

  server.registerTool(
    "get_content",
    {
      title: "Get published site content",
      description: "Fetch the full body and metadata for any published authored content item.",
      inputSchema: z
        .object({
          type: z.enum(CONTENT_TABLES),
          slug: z.string().min(1).max(300),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ type, slug }) => {
      const sql = getDatabase();
      const rows = await sql.unsafe<ContentRow[]>(
        `SELECT '${type}' AS type, slug, title, preview, category_slug,
                start_date, status, body
         FROM content.${type}
         WHERE slug = $1 AND state = 'active'
         LIMIT 1`,
        [slug],
      );
      if (rows.length === 0) return textResult(`No published ${type} content found for: ${slug}`);

      const row = rows[0] as ContentRow & { status?: string | null };
      const metadata = [
        `Type: ${type}`,
        row.category_slug ? `Category: ${row.category_slug}` : "",
        row.status ? `Status: ${row.status}` : "",
        row.start_date ? `Date: ${row.start_date}` : "",
      ].filter(Boolean);
      return textResult(
        `${row.title}\n${metadata.join("\n")}\n\n${row.body || row.preview || ""}\n\n${contentUrl(type, row.slug)}`,
      );
    },
  );

  server.registerTool(
    "list_content_types",
    {
      title: "List published content types",
      description: "List every MCP-searchable site content type with its current published item count.",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    async () => {
      const sql = getDatabase();
      const standardCounts = await Promise.all(
        CONTENT_TABLES.map(async (type) => {
          const rows = await sql.unsafe<{ count: string }[]>(
            `SELECT COUNT(*)::text AS count FROM content.${type} WHERE state = 'active'`,
          );
          return { type, count: rows[0]?.count || "0" };
        }),
      );
      const specialCounts = await sql<{ type: string; count: string }[]>`
        SELECT 'sequences' AS type, COUNT(*)::text AS count
          FROM content.sequences WHERE state = 'active'
        UNION ALL
        SELECT 'documents', COUNT(*)::text
          FROM content.documents WHERE state = 'active'
        UNION ALL
        SELECT 'prompts', COUNT(*)::text
          FROM content.prompts WHERE state = 'active'
        UNION ALL
        SELECT 'notebooks', COUNT(*)::text
          FROM content.notebooks WHERE state = 'active'
        UNION ALL
        SELECT 'til', COUNT(*)::text
          FROM system.til WHERE state = 'active'
      `;
      const rows = [...standardCounts, ...specialCounts];
      return textResult(rows.map((row) => `${row.type} (${row.count})`).join("\n"));
    },
  );

  server.registerTool(
    "search_reference",
    {
      title: "Search the reference collection",
      description: "Search published poems, reference essays, and prayers by title, author, or full text.",
      inputSchema: z
        .object({
          query: z.string().min(1).max(200),
          type: z.enum(["all", "poems", "essais", "prayer"]).optional().default("all"),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ query, type }) => {
      const sql = getDatabase();
      const pattern = `%${query}%`;
      const lines: string[] = [];

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
        `;
        for (const row of rows) {
          lines.push(
            formatResult(
              "poem",
              row.title,
              row.author_name,
              `${BASE_URL}/poetry/${row.path}`,
              row.first_line,
            ),
          );
        }
      }

      if (type === "all" || type === "essais") {
        const rows = await sql<ReferenceRow[]>`
          SELECT slug, title, author_name, path, text
          FROM reference.essais
          WHERE state = 'active'
            AND (
              title ILIKE ${pattern}
              OR author_name ILIKE ${pattern}
              OR COALESCE(text, '') ILIKE ${pattern}
            )
          LIMIT 20
        `;
        for (const row of rows) {
          lines.push(
            formatResult(
              "essay",
              row.title,
              row.author_name,
              `${BASE_URL}/essais/${row.path}`,
              row.text,
            ),
          );
        }
      }

      if (type === "all" || type === "prayer") {
        const rows = await sql<ReferenceRow[]>`
          SELECT slug, title, author_name, path, text
          FROM reference.prayer
          WHERE state = 'active'
            AND (
              title ILIKE ${pattern}
              OR author_name ILIKE ${pattern}
              OR COALESCE(text, '') ILIKE ${pattern}
            )
          LIMIT 20
        `;
        for (const row of rows) {
          lines.push(
            formatResult(
              "prayer",
              row.title,
              row.author_name,
              `${BASE_URL}/prayer/${row.path}`,
              row.text,
            ),
          );
        }
      }

      return lines.length === 0
        ? textResult(`No results for "${query}".`)
        : textResult(`${lines.length} results:\n\n${lines.join("\n\n")}`);
    },
  );

  server.registerTool(
    "get_poem",
    {
      title: "Get a poem",
      description: "Fetch a published poem by its poet-slug/poem-slug path.",
      inputSchema: z.object({ path: z.string().min(1).max(300) }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ path }) => {
      const sql = getDatabase();
      const rows = await sql<{ title: string; author_name: string; text: string | null }[]>`
        SELECT title, author_name, text
        FROM reference.poems
        WHERE path = ${path} AND state = 'active'
        LIMIT 1
      `;
      if (rows.length === 0) return textResult(`No poem found at path: ${path}`);

      const poem = rows[0];
      return textResult(
        `${poem.title}\n${poem.author_name}\n\n${poem.text ?? ""}\n\n${BASE_URL}/poetry/${path}`,
      );
    },
  );

  server.registerTool(
    "list_poets",
    {
      title: "List poets",
      description: "List poets in the published poetry collection with poem counts.",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    async () => {
      const sql = getDatabase();
      const rows = await sql<{ author_name: string; author_slug: string; count: string }[]>`
        SELECT author_name, author_slug, COUNT(*)::text AS count
        FROM reference.poems
        WHERE state = 'active'
        GROUP BY author_slug, author_name
        ORDER BY COUNT(*) DESC, author_name
      `;
      if (rows.length === 0) return textResult("No poets found.");

      const lines = rows.map(
        (row) => `${row.author_name} (${row.count}) | ${BASE_URL}/poetry/${row.author_slug}`,
      );
      return textResult(`${rows.length} poets:\n\n${lines.join("\n")}`);
    },
  );

});

export { handler as GET, handler as POST };
