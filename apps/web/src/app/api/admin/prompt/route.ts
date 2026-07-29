import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

const PROMPT_ID = "default";

function isValidIanaTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const prompt = await prisma.promptConfig.findUnique({ where: { id: PROMPT_ID } });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt config not found." }, { status: 404 });
  }

  return NextResponse.json({ prompt });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    template?: string;
    periodHours?: number;
    boardStaleDays?: number;
    displayTimezone?: string;
    language?: string;
  };

  const existing = await prisma.promptConfig.findUnique({ where: { id: PROMPT_ID } });
  if (!existing) {
    return NextResponse.json({ error: "Prompt config not found." }, { status: 404 });
  }

  const data: {
    template?: string;
    periodHours?: number;
    boardStaleDays?: number;
    displayTimezone?: string;
    language?: string;
  } = {};

  if (body.template !== undefined) {
    const template = body.template.trim();
    if (!template) {
      return NextResponse.json({ error: "Template is required." }, { status: 400 });
    }
    data.template = template;
  }

  if (body.periodHours !== undefined) {
    if (!Number.isInteger(body.periodHours) || body.periodHours < 1 || body.periodHours > 168) {
      return NextResponse.json(
        { error: "Period hours must be an integer between 1 and 168." },
        { status: 400 },
      );
    }
    data.periodHours = body.periodHours;
  }

  if (body.boardStaleDays !== undefined) {
    if (!Number.isInteger(body.boardStaleDays) || body.boardStaleDays < 1 || body.boardStaleDays > 14) {
      return NextResponse.json(
        { error: "Board stale days must be an integer between 1 and 14." },
        { status: 400 },
      );
    }
    data.boardStaleDays = body.boardStaleDays;
  }

  if (body.displayTimezone !== undefined) {
    const displayTimezone = body.displayTimezone.trim();
    if (!displayTimezone) {
      return NextResponse.json({ error: "Display timezone is required." }, { status: 400 });
    }
    if (!isValidIanaTimeZone(displayTimezone)) {
      return NextResponse.json(
        { error: "Display timezone must be a valid IANA name (e.g. Europe/Moscow)." },
        { status: 400 },
      );
    }
    data.displayTimezone = displayTimezone;
  }

  if (body.language !== undefined) {
    const language = body.language.trim();
    if (!language) {
      return NextResponse.json({ error: "Language is required." }, { status: 400 });
    }
    if (language.length > 80) {
      return NextResponse.json({ error: "Language must be at most 80 characters." }, { status: 400 });
    }
    data.language = language;
  }

  const prompt = await prisma.promptConfig.update({
    where: { id: PROMPT_ID },
    data,
  });

  return NextResponse.json({ prompt });
}
