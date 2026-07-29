import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

const ABOUT_ID = "default";

const DEFAULT_FOOTER_LABEL_EN = "About / Collaboration";
const DEFAULT_FOOTER_LABEL_RU = "О продукте / Сотрудничество";

const STRING_FIELDS = [
  "footerLabelEn",
  "footerLabelRu",
  "pageTitleEn",
  "pageTitleRu",
  "leadEn",
  "leadRu",
  "productEn",
  "productRu",
  "outlookEn",
  "outlookRu",
  "collaborationEn",
  "collaborationRu",
] as const;

type AboutPatchBody = {
  enabledEn?: boolean;
  enabledRu?: boolean;
} & Partial<Record<(typeof STRING_FIELDS)[number], string>>;

function resolveFooterLabel(
  enabled: boolean,
  label: string,
  defaultLabel: string,
): string {
  const trimmed = label.trim();
  if (enabled && !trimmed) {
    return defaultLabel;
  }
  return trimmed;
}

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const about = await prisma.aboutPage.findUnique({ where: { id: ABOUT_ID } });
  if (!about) {
    return NextResponse.json({ error: "About page not found." }, { status: 404 });
  }

  return NextResponse.json({ about });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as AboutPatchBody;

  const existing = await prisma.aboutPage.findUnique({ where: { id: ABOUT_ID } });
  if (!existing) {
    return NextResponse.json({ error: "About page not found." }, { status: 404 });
  }

  const data: {
    enabledEn?: boolean;
    enabledRu?: boolean;
    footerLabelEn?: string;
    footerLabelRu?: string;
    pageTitleEn?: string;
    pageTitleRu?: string;
    leadEn?: string;
    leadRu?: string;
    productEn?: string;
    productRu?: string;
    outlookEn?: string;
    outlookRu?: string;
    collaborationEn?: string;
    collaborationRu?: string;
  } = {};

  if (body.enabledEn !== undefined) {
    data.enabledEn = Boolean(body.enabledEn);
  }
  if (body.enabledRu !== undefined) {
    data.enabledRu = Boolean(body.enabledRu);
  }

  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined) {
      data[field] = body[field]!.trim();
    }
  }

  const enabledEn = data.enabledEn ?? existing.enabledEn;
  const enabledRu = data.enabledRu ?? existing.enabledRu;

  const footerLabelEnSource =
    data.footerLabelEn !== undefined ? data.footerLabelEn : existing.footerLabelEn;
  const footerLabelRuSource =
    data.footerLabelRu !== undefined ? data.footerLabelRu : existing.footerLabelRu;

  const footerLabelEn = resolveFooterLabel(
    enabledEn,
    footerLabelEnSource,
    DEFAULT_FOOTER_LABEL_EN,
  );
  const footerLabelRu = resolveFooterLabel(
    enabledRu,
    footerLabelRuSource,
    DEFAULT_FOOTER_LABEL_RU,
  );

  if (
    body.footerLabelEn !== undefined ||
    body.enabledEn !== undefined ||
    footerLabelEn !== existing.footerLabelEn
  ) {
    data.footerLabelEn = footerLabelEn;
  }
  if (
    body.footerLabelRu !== undefined ||
    body.enabledRu !== undefined ||
    footerLabelRu !== existing.footerLabelRu
  ) {
    data.footerLabelRu = footerLabelRu;
  }

  const about = await prisma.aboutPage.update({
    where: { id: ABOUT_ID },
    data,
  });

  return NextResponse.json({ about });
}
