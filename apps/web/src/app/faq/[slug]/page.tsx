import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import { siteFooterLinks } from "@/lib/about-page";
import { prisma } from "@/lib/db";
import { listActiveFaqEntries } from "@/lib/faq-space-db";

export const dynamic = "force-dynamic";

type FaqPageProps = {
  params: Promise<{ slug: string }>;
};

function formatConfirmedAt(value: Date | null): string | null {
  if (!value) return null;
  return value.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function FaqPublicPage({ params }: FaqPageProps) {
  const { slug } = await params;
  const [space, about] = await Promise.all([
    prisma.faqSpace.findUnique({
      where: { slug },
      select: {
        id: true,
        enabled: true,
        name: true,
        slug: true,
        topic: { select: { id: true, name: true, enabled: true } },
      },
    }),
    prisma.aboutPage.findUnique({ where: { id: "default" } }),
  ]);

  if (!space || !space.enabled || !space.topic.enabled) {
    notFound();
  }

  const entries = await listActiveFaqEntries(space.id);
  const title = space.name.trim() || `${space.topic.name} FAQ`;

  return (
    <main className="shell">
      <SiteHeader
        actions={
          <Link href="/" className="nav-link">
            Board
          </Link>
        }
      />

      <article className="about-article panel">
        <p className="muted" style={{ marginBottom: "0.35rem" }}>
          FAQ · {space.topic.name}
        </p>
        <h1>{title}</h1>
        <p className="about-lead">
          Living answers from topic sources. Refresh from Admin when ingest has new evidence.
        </p>

        {entries.length === 0 ? (
          <p className="muted">No FAQ entries yet.</p>
        ) : (
          <div className="faq-list">
            {entries.map((entry) => {
              const confirmed = formatConfirmedAt(entry.lastConfirmedAt);
              return (
                <section key={entry.id} className="faq-entry">
                  <h2>{entry.question}</h2>
                  <p style={{ whiteSpace: "pre-wrap" }}>{entry.answer}</p>
                  {confirmed ? (
                    <p className="muted" style={{ fontSize: "0.85rem" }}>
                      Confirmed {confirmed}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </article>

      <SiteFooter links={siteFooterLinks(about)} />
    </main>
  );
}
