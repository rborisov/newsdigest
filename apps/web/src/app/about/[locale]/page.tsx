import Link from "next/link";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import {
  aboutFooterLinks,
  aboutSectionLabels,
  isAboutLocaleEnabled,
  parseAboutLocale,
  pickAboutLocaleContent,
  type AboutLocale,
} from "@/lib/about-page";
import { renderAboutMarkdown } from "@/lib/about-markdown";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type AboutLocalePageProps = {
  params: Promise<{ locale: string }>;
};

function aboutPageTitle(content: { pageTitle: string; footerLabel: string }, locale: AboutLocale) {
  const title = content.pageTitle.trim();
  if (title) return title;
  const footerLabel = content.footerLabel.trim();
  if (footerLabel) return footerLabel;
  return locale === "ru" ? "О продукте" : "About";
}

function otherEnabledLocales(
  page: { enabledEn: boolean; enabledRu: boolean },
  current: AboutLocale,
): AboutLocale[] {
  const locales: AboutLocale[] = [];
  if (page.enabledEn && current !== "en") locales.push("en");
  if (page.enabledRu && current !== "ru") locales.push("ru");
  return locales;
}

function localeSwitchLabel(locale: AboutLocale) {
  return locale === "en" ? "English" : "Русский";
}

export default async function AboutLocalePage({ params }: AboutLocalePageProps) {
  const { locale: rawLocale } = await params;
  const locale = parseAboutLocale(rawLocale);
  if (!locale) notFound();

  const about = await prisma.aboutPage.findUnique({ where: { id: "default" } });
  if (!about || !isAboutLocaleEnabled(about, locale)) notFound();

  const content = pickAboutLocaleContent(about, locale);
  const labels = aboutSectionLabels(locale);
  const sections = [
    { key: "product", label: labels.product, body: content.product },
    { key: "outlook", label: labels.outlook, body: content.outlook },
    { key: "collaboration", label: labels.collaboration, body: content.collaboration },
  ].filter((section) => section.body.trim());

  const switchLocales = otherEnabledLocales(about, locale);
  const footerLinks = aboutFooterLinks(about);

  return (
    <main className="shell">
      <SiteHeader />

      {switchLocales.length > 0 ? (
        <nav className="about-lang-switch" aria-label="Language">
          {switchLocales.map((switchLocale) => (
            <Link key={switchLocale} href={`/about/${switchLocale}`}>
              {localeSwitchLabel(switchLocale)}
            </Link>
          ))}
        </nav>
      ) : null}

      <article className="about-article panel">
        <h1>{aboutPageTitle(content, locale)}</h1>
        {content.lead.trim() ? <p className="about-lead">{content.lead.trim()}</p> : null}
        {sections.map((section) => {
          const html = renderAboutMarkdown(section.body);
          if (!html) return null;
          return (
            <section key={section.key} className="about-section">
              <h2>{section.label}</h2>
              <div className="about-body" dangerouslySetInnerHTML={{ __html: html }} />
            </section>
          );
        })}
      </article>

      <SiteFooter links={footerLinks} />
    </main>
  );
}
