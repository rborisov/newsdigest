export type AboutLocale = "en" | "ru";

export type AboutPageContentFields = {
  footerLabelEn: string;
  footerLabelRu: string;
  pageTitleEn: string;
  pageTitleRu: string;
  leadEn: string;
  leadRu: string;
  productEn: string;
  productRu: string;
  outlookEn: string;
  outlookRu: string;
  collaborationEn: string;
  collaborationRu: string;
};

export type AboutLocaleContent = {
  footerLabel: string;
  pageTitle: string;
  lead: string;
  product: string;
  outlook: string;
  collaboration: string;
};

export function resolveAboutRedirectLocale(page: {
  enabledEn: boolean;
  enabledRu: boolean;
}): AboutLocale | null {
  if (page.enabledEn) return "en";
  if (page.enabledRu) return "ru";
  return null;
}

export function isAboutLocaleEnabled(
  page: { enabledEn: boolean; enabledRu: boolean },
  locale: AboutLocale,
): boolean {
  return locale === "en" ? page.enabledEn : page.enabledRu;
}

export function pickAboutLocaleContent(
  page: AboutPageContentFields,
  locale: AboutLocale,
): AboutLocaleContent {
  if (locale === "en") {
    return {
      footerLabel: page.footerLabelEn,
      pageTitle: page.pageTitleEn,
      lead: page.leadEn,
      product: page.productEn,
      outlook: page.outlookEn,
      collaboration: page.collaborationEn,
    };
  }
  return {
    footerLabel: page.footerLabelRu,
    pageTitle: page.pageTitleRu,
    lead: page.leadRu,
    product: page.productRu,
    outlook: page.outlookRu,
    collaboration: page.collaborationRu,
  };
}

export function aboutSectionLabels(locale: AboutLocale) {
  return locale === "ru"
    ? { product: "Продукт", outlook: "Перспективы", collaboration: "Сотрудничество" }
    : { product: "Product", outlook: "Outlook", collaboration: "Collaboration" };
}

export function parseAboutLocale(raw: string): AboutLocale | null {
  if (raw === "en" || raw === "ru") return raw;
  return null;
}

export function aboutFooterLinks(page: {
  enabledEn: boolean;
  enabledRu: boolean;
  footerLabelEn: string;
  footerLabelRu: string;
}): { href: string; label: string }[] {
  const links = [];
  if (page.enabledEn) {
    links.push({
      href: "/about/en",
      label: page.footerLabelEn || "About / Collaboration",
    });
  }
  if (page.enabledRu) {
    links.push({
      href: "/about/ru",
      label: page.footerLabelRu || "О продукте / Сотрудничество",
    });
  }
  return links;
}

/** Site-wide footer: digests first, then enabled About locales. */
export function siteFooterLinks(
  page: {
    enabledEn: boolean;
    enabledRu: boolean;
    footerLabelEn: string;
    footerLabelRu: string;
  } | null,
): { href: string; label: string }[] {
  return [
    { href: "/digests", label: "Recent digests" },
    { href: "/reviews", label: "Recent reviews" },
    ...(page ? aboutFooterLinks(page) : []),
  ];
}
