import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type PublishResponse = {
  ok?: boolean;
  error?: string;
  jobId?: string;
  digestUrl?: string;
  digestPath?: string;
  indexUrl?: string;
  indexPath?: string;
  topicPageId?: string;
  publishedPageId?: string;
  softFail?: boolean;
  idempotent?: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function portalBaseUrl(): string {
  return requireEnv("PORTAL_URL").replace(/\/$/, "");
}

const storySchema = z.object({
  title: z.string().min(1),
  canonicalUrl: z.string().nullable().optional(),
  titleKey: z.string().optional(),
});

function createServer(): McpServer {
  const server = new McpServer({
    name: "news-digest",
    version: "0.1.0",
  });

  server.registerTool(
    "publish_digest_page",
    {
      description:
        "Publish a single-topic news digest HTML page to Telegra.ph via the portal internal API. Call once per topic_publish step with that topic's HTML only.",
      inputSchema: {
        jobId: z.string().min(1).describe("Generation job ID from the agent prompt"),
        stepId: z.string().optional().describe("Generation step ID for this topic publish"),
        topicId: z.string().optional().describe("Topic ID when publishing a single topic page"),
        topicName: z.string().optional().describe("Topic name for this publish (required unless stepId resolves it)"),
        title: z.string().min(1).describe("Digest page title"),
        htmlContent: z.string().min(1).describe("HTML body for the digest page"),
        stories: z
          .array(storySchema)
          .optional()
          .describe("Optional story fingerprints for deduplication metadata"),
      },
    },
    async ({ jobId, stepId, topicId, topicName, title, htmlContent, stories }) => {
      const response = await fetch(`${portalBaseUrl()}/api/internal/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": requireEnv("INTERNAL_API_KEY"),
        },
        body: JSON.stringify({
          jobId,
          ...(stepId ? { stepId } : {}),
          ...(topicId ? { topicId } : {}),
          ...(topicName ? { topicName } : {}),
          title,
          htmlContent,
          ...(stories && stories.length > 0 ? { stories } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as PublishResponse;

      if (!response.ok) {
        const message = data.error ?? `Publish failed with status ${response.status}`;
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                jobId: data.jobId ?? jobId,
                digestUrl: data.digestUrl ?? "",
                digestPath: data.digestPath ?? "",
                indexUrl: data.indexUrl ?? "",
                indexPath: data.indexPath ?? "",
                topicPageId: data.topicPageId ?? data.publishedPageId,
                publishedPageId: data.publishedPageId ?? data.topicPageId,
                idempotent: data.idempotent ?? false,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("News Digest MCP server running on stdio");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", message);
  process.exit(1);
});
