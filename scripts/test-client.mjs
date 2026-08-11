import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const origin =
  process.argv.slice(2).find((argument) => argument !== "--") ||
  "http://localhost:3000";

async function main() {
  const client = new Client({ name: "krisyotam-mcp-test", version: "1.0.0" });
  const endpoint = new URL("/mcp", `${origin}/`);
  const transport = new StreamableHTTPClientTransport(endpoint);

  console.log("Connecting to", endpoint.toString());
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log("Tools", tools.map(({ name }) => name));

  const result = await client.callTool({
    name: "search_content",
    arguments: { query: "poetry" },
  });
  console.log("Result", result);

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
