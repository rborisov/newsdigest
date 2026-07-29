import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PROMPT_TEMPLATE = `You are a news digest editor. Compile a concise digest of recent news for the topics below.

Write the digest in {{LANGUAGE}}.

Topics:
{{TOPICS}}

Lookback period: {{PERIOD_HOURS}} hours
Date: {{DATE}}

Do NOT include any story listed under EXCLUDE_STORIES (match by URL first, then by near-identical title).
Prefer source URLs so future digests can deduplicate reliably.

EXCLUDE_STORIES:
{{EXCLUDE_STORIES}}

When ready, publish via the publish_digest_page MCP tool.
Do not finish until publish_digest_page returns a URL.
If publish fails, retry once then report the error.

Note: multi-topic Generate runs use one publish step per enabled topic. The job footer names the single topic for this step — research and publish only that topic via publish_digest_page.`;

function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

async function main() {
  const emails = parseAllowedEmails(process.env.ALLOWED_EMAILS);

  for (const email of emails) {
    // ALLOWED_EMAILS bootstraps missing rows only; create still sets isAdmin: true.
    await prisma.allowedUser.upsert({
      where: { email },
      update: {},
      create: { email, isAdmin: true },
    });
  }

  await prisma.promptConfig.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      template: DEFAULT_PROMPT_TEMPLATE,
      periodHours: 24,
      boardStaleDays: 1,
      displayTimezone: "UTC",
      language: "English",
    },
  });

  await prisma.telegraphMeta.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      accessToken: "",
      currentIndexPath: "",
      currentIndexUrl: "",
      authorName: "",
      authorUrl: "",
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
