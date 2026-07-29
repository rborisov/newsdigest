import { notFound, redirect } from "next/navigation";

import { resolveAboutRedirectLocale } from "@/lib/about-page";
import { prisma } from "@/lib/db";

export default async function AboutIndexPage() {
  const about = await prisma.aboutPage.findUnique({ where: { id: "default" } });
  if (!about) notFound();
  const locale = resolveAboutRedirectLocale(about);
  if (!locale) notFound();
  redirect(`/about/${locale}`);
}
