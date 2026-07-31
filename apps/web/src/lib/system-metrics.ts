import { existsSync, readdirSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import path from "node:path";

import { prisma } from "./db";
import { resolveJobLogDir } from "./job-logs";
import { resolveAgentWorkspace } from "./cursor";
import { resolveIllustrationsRoot } from "./topic-illustrations";

export type DirSize = {
  path: string;
  bytes: number;
  fileCount: number;
  exists: boolean;
};

export type DiskStat = {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
};

export type SystemMetrics = {
  serverTime: string;
  disk: DiskStat | null;
  digests: {
    root: string;
    database: { path: string; bytes: number; exists: boolean };
    illustrations: DirSize;
    jobLogs: DirSize;
    workspace: DirSize;
    totalBytes: number;
  };
  telegraph: {
    storage: "external";
    note: string;
    localHtmlBytesApprox: number;
    topicPageCount: number;
  };
  cursor: {
    apiKeyConfigured: boolean;
    usageTracked: true;
    note: string;
    totals: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalTokens: number;
      stepsWithUsage: number;
    };
    recentSteps: Array<{
      id: string;
      jobId: string;
      topicName: string | null;
      model: string | null;
      totalTokens: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
      updatedAt: string;
    }>;
  };
};

function resolveDatabasePath(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const fileMatch = /^file:(.+)$/.exec(databaseUrl);
  if (fileMatch?.[1]) {
    const dbPath = fileMatch[1];
    return path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
  }
  if (existsSync("/opt/newsdigest/data/digest.db")) {
    return "/opt/newsdigest/data/digest.db";
  }
  return path.join(process.cwd(), "prisma", "dev.db");
}

function resolveDataRoot(): string {
  const dbPath = resolveDatabasePath();
  return path.dirname(dbPath);
}

function fileSize(filePath: string): { path: string; bytes: number; exists: boolean } {
  try {
    if (!existsSync(filePath)) {
      return { path: filePath, bytes: 0, exists: false };
    }
    return { path: filePath, bytes: statSync(filePath).size, exists: true };
  } catch {
    return { path: filePath, bytes: 0, exists: false };
  }
}

export function measureDir(dirPath: string): DirSize {
  if (!existsSync(dirPath)) {
    return { path: dirPath, bytes: 0, fileCount: 0, exists: false };
  }

  let bytes = 0;
  let fileCount = 0;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          bytes += statSync(full).size;
          fileCount += 1;
        }
      } catch {
        // skip unreadable entries
      }
    }
  }

  return { path: dirPath, bytes, fileCount, exists: true };
}

export async function readDiskStat(targetPath: string): Promise<DiskStat | null> {
  try {
    const stats = await statfs(targetPath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      path: targetPath,
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
    };
  } catch {
    return null;
  }
}

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const dataRoot = resolveDataRoot();
  const database = fileSize(resolveDatabasePath());
  const illustrations = measureDir(resolveIllustrationsRoot());
  const jobLogs = measureDir(resolveJobLogDir());
  const workspace = measureDir(resolveAgentWorkspace());
  const disk = (await readDiskStat(dataRoot)) ?? (await readDiskStat("/"));

  const [stepAgg, recentSteps, pages] = await Promise.all([
    prisma.generationStep.aggregate({
      where: { totalTokens: { not: null } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        totalTokens: true,
      },
      _count: { _all: true },
    }),
    prisma.generationStep.findMany({
      where: { totalTokens: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        jobId: true,
        topicName: true,
        model: true,
        totalTokens: true,
        inputTokens: true,
        outputTokens: true,
        updatedAt: true,
      },
    }),
    prisma.topicPage.findMany({
      select: { htmlContent: true },
    }),
  ]);

  const localHtmlBytesApprox = pages.reduce(
    (sum, page) => sum + Buffer.byteLength(page.htmlContent ?? "", "utf8"),
    0,
  );

  return {
    serverTime: new Date().toISOString(),
    disk,
    digests: {
      root: dataRoot,
      database,
      illustrations,
      jobLogs,
      workspace,
      totalBytes:
        database.bytes + illustrations.bytes + jobLogs.bytes + workspace.bytes,
    },
    telegraph: {
      storage: "external",
      note: "Full digests are hosted on Telegra.ph. Local DB keeps HTML copies for the board.",
      localHtmlBytesApprox,
      topicPageCount: pages.length,
    },
    cursor: {
      apiKeyConfigured: Boolean(process.env.CURSOR_API_KEY?.trim()),
      usageTracked: true,
      note: "Token totals are recorded from Cursor CLI stream-json for new runs after this deploy.",
      totals: {
        inputTokens: stepAgg._sum.inputTokens ?? 0,
        outputTokens: stepAgg._sum.outputTokens ?? 0,
        cacheReadTokens: stepAgg._sum.cacheReadTokens ?? 0,
        cacheWriteTokens: stepAgg._sum.cacheWriteTokens ?? 0,
        totalTokens: stepAgg._sum.totalTokens ?? 0,
        stepsWithUsage: stepAgg._count._all,
      },
      recentSteps: recentSteps.map((step) => ({
        id: step.id,
        jobId: step.jobId,
        topicName: step.topicName,
        model: step.model,
        totalTokens: step.totalTokens,
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens,
        updatedAt: step.updatedAt.toISOString(),
      })),
    },
  };
}
