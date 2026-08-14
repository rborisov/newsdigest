import { PrismaClient } from "@prisma/client";

import { DEFAULT_REVIEW_TEMPLATE } from "../src/lib/story-review";

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
      boardStaleDays: 0,
      displayTimezone: "UTC",
      language: "English",
      reviewTemplate: DEFAULT_REVIEW_TEMPLATE,
    },
  });

  await prisma.promptConfig.updateMany({
    where: { id: "default", reviewTemplate: "" },
    data: { reviewTemplate: DEFAULT_REVIEW_TEMPLATE },
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

  await prisma.aboutPage.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      enabledEn: true,
      enabledRu: true,
      footerLabelEn: "About / Collaboration",
      footerLabelRu: "О продукте / Сотрудничество",
      pageTitleEn: "n. — a configurable news desk",
      pageTitleRu: "n. — настраиваемый новостной desk",
      leadEn:
        "An editor-run news digest: you choose the topics and how deep to go. An agent researches on a schedule; readers get a live board and a history index, with full articles hosted off the VPS.",
      leadRu:
        "Редакционный новостной дайджест: темы и глубину разбора задаёте вы. Агент исследует по расписанию; читатели видят актуальную доску и индекс истории, а полные тексты хранятся вне VPS.",
      productEn: `**n.** is a self-hosted news desk for editors, not another infinite feed.

- Configure topics and keywords; set schedules or generate on demand.
- Optionally mark topics for deeper treatment — fact-checking, source links, and context — with prompts you own.
- Readers browse the current board and follow links to full digests; the VPS keeps an index so past topics and stories stay findable while article bodies live on inexpensive external storage (Telegra.ph by default).
- Runs on a small VPS alongside an AI worker you control.`,
      productRu: `**n.** — self-hosted новостной desk для редакторов, а не очередная бесконечная лента.

- Настраивайте темы и ключевые слова; задавайте расписание или запускайте генерацию по запросу.
- При необходимости отмечайте темы для глубокого разбора — проверка фактов, ссылки на источники и контекст — с промптами, которые контролируете вы.
- Читатели просматривают актуальную доску и переходят по ссылкам к полным дайджестам; VPS хранит индекс, чтобы прошлые темы и сюжеты оставались доступны, а тексты статей — на недорогом внешнем хранилище (по умолчанию Telegra.ph).
- Работает на небольшом VPS вместе с AI-воркером под вашим контролем.`,
      outlookEn: `The desk is built to stay thin on the server and flexible at the edges:

- **Storage:** Telegra.ph as a simple default; other backends when branding or control matter.
- **AI worker:** hosted agent we operate, your own API key in Admin, or a model you (or we) run on your hardware — same editorial pipeline either way.
- **Next:** richer history search, exports (email, Telegram, RSS), and white-label desks for private monitoring.`,
      outlookRu: `Desk спроектирован так, чтобы сервер оставался «тонким», а гибкость — на периферии:

- **Хранилище:** Telegra.ph как простой вариант по умолчанию; другие бэкенды, когда важны брендинг или контроль.
- **AI worker:** наш hosted-агент, ваш API-ключ в Admin или модель на вашем железе (или на нашем) — редакционный pipeline один и тот же.
- **Дальше:** расширенный поиск по истории, экспорт (email, Telegram, RSS) и white-label desks для приватного мониторинга.`,
      collaborationEn: `Ways to work together:

1. **Managed desk** — we host and tune topics/prompts; you get a ready portal and cadence.
2. **Self-hosted** — install on your VPS; we help with setup and updates.
3. **BYO agent** — bring your own model/API key; pay for the desk software and editorial tooling, not our inference.
4. **Private / white-label** — brand monitoring or member digests under your domain.

If this fits a channel, newsroom, research team, or corporate monitoring need, reach out with your use case and preferred setup. (Add your contact details here.)`,
      collaborationRu: `Варианты сотрудничества:

1. **Managed desk** — мы хостим и настраиваем темы/промпты; вы получаете готовый портал и нужный ритм выпусков.
2. **Self-hosted** — установка на ваш VPS; помогаем с настройкой и обновлениями.
3. **BYO agent** — своя модель/API-ключ; платите за desk и редакционные инструменты, а не за наш inference.
4. **Private / white-label** — мониторинг бренда или дайджесты для участников под вашим доменом.

Если это подходит каналу, редакции, исследовательской группе или корпоративному мониторингу — напишите с описанием задачи и предпочитаемого формата. (Укажите здесь контактные данные.)`,
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
