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
  publishedPageId?: string;
  softFail?: boolean;
  idempotent?: boolean;
};

type SaveDraftResponse = {
  ok?: boolean;
  error?: string;
  jobId?: string;
  stepId?: string;
  nextStepId?: string | null;
  nextKind?: string | null;
  advanced?: boolean;
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
    "save_topic_draft",
    {
      description:
        "Save a single-topic HTML draft for the current generation pipeline step. Does not publish to Telegra.ph. Call once per topic_draft step; the portal then starts the next step.",
      inputSchema: {
        jobId: z.string().min(1).describe("Generation job ID from the agent prompt"),
        topic: z.string().min(1).describe("Topic name exactly as given in the prompt"),
        html: z.string().min(1).describe("HTML section for this topic only"),
        stories: z
          .array(storySchema)
          .optional()
          .describe("Optional story fingerprints for this topic draft"),
      },
    },
    async ({ jobId, topic, html, stories }) => {
      const response = await fetch(`${portalBaseUrl()}/api/internal/save-topic-draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": requireEnv("INTERNAL_API_KEY"),
        },
        body: JSON.stringify({
          jobId,
          topic,
          html,
          ...(stories && stories.length > 0 ? { stories } : {}),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as SaveDraftResponse;

      if (!response.ok) {
        const message = data.error ?? `Save draft failed with status ${response.status}`;
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
                stepId: data.stepId,
                nextStepId: data.nextStepId ?? null,
                nextKind: data.nextKind ?? null,
                advanced: data.advanced ?? false,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "publish_digest_page",
    {
      description:
        "Publish a news digest HTML page to Telegra.ph via the portal internal API. Use only on the final merge_publish step after all topic drafts are saved.",
      inputSchema: {
        jobId: z.string().min(1).describe("Generation job ID from the agent prompt"),
        title: z.string().min(1).describe("Digest page title"),
        htmlContent: z.string().min(1).describe("HTML body for the digest page"),
        stories: z
          .array(storySchema)
          .optional()
          .describe("Optional story fingerprints for deduplication metadata"),
      },
    },
    async ({ jobId, title, htmlContent, stories }) => {
      const response = await fetch(`${portalBaseUrl()}/api/internal/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": requireEnv("INTERNAL_API_KEY"),
        },
        body: JSON.stringify({
          jobId,
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
                publishedPageId: data.publishedPageId,
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
