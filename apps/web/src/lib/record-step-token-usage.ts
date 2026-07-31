import type { PrismaClient } from "@prisma/client";

import { readAgentStreamUsage } from "./agent-stream-usage";
import { prisma as defaultPrisma } from "./db";
import { agentStreamLogPath, appendJobLogLine } from "./job-logs";

/** Persist Cursor stream-json token usage onto a generation step (idempotent overwrite). */
export async function recordStepTokenUsage(
  jobId: string,
  stepId: string,
  deps: { prisma?: PrismaClient } = {},
): Promise<boolean> {
  const client = deps.prisma ?? defaultPrisma;
  const usage = readAgentStreamUsage(agentStreamLogPath(jobId, stepId));
  if (!usage) {
    return false;
  }

  await client.generationStep.update({
    where: { id: stepId },
    data: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      totalTokens: usage.totalTokens,
      model: usage.model,
    },
  });

  appendJobLogLine(
    jobId,
    `token usage: in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens} total=${usage.totalTokens}` +
      (usage.model ? ` model=${usage.model}` : ""),
    stepId,
  );

  return true;
}
