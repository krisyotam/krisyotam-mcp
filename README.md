# krisyotam-mcp

A stateless Model Context Protocol server for the public corpus on
[krisyotam.com](https://krisyotam.com). It uses `mcp-handler` 2 and the MCP
TypeScript SDK v2 inside a Next.js App Router endpoint.

## Endpoint

The Streamable HTTP endpoint is:

```text
https://your-deployment.example/mcp
```

The current MCP protocol is served natively. Stateless clients using the
2025-era Streamable HTTP protocol are supported by `mcp-handler`. The removed
HTTP+SSE transport is not supported, and Redis is not required.

## Tools

- `search_all`: search every site content type and the reference collections
- `search_content`: search authored content, sequences, documents, prompts,
  notebooks, and TIL entries by type
- `get_content`: fetch the full body of any published authored content item
- `list_content_types`: list searchable types and published item counts
- `search_reference`: search poems, essays, and prayers
- `get_poem`: fetch a poem by its collection path
- `list_poets`: list poets and poem counts

## Local setup

Requirements: Node.js 20 or later and pnpm.

```sh
cp .env.example .env.local
pnpm install
pnpm dev
```

Set `DATABASE_URL` to a Postgres connection string for a database role that is
restricted to `SELECT` on the tables used by these tools. The public MCP does
not accept arbitrary SQL because the site database also contains private
analytics, interaction, survey, and storage records.

The authored content tables are `blog`, `diary`, `essays`, `fiction`, `news`,
`ocs`, `papers`, `prayers`, `progymnasmata`, `reviews`, and `verse`. Search also
includes `sequences`, `documents`, `prompts`, `notebooks`, and `til`.

Test a running server with:

```sh
pnpm test:client -- http://localhost:3000
```

## Vercel

Create a Vercel project from this repository, add `DATABASE_URL`, and enable
Fluid compute. The database must be reachable from Vercel over TLS.

## License

MIT
