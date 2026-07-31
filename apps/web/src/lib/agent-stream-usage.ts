import { readFileSync, existsSync } from "node:fs";

export type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  model: string | null;
};

function asNonNegInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) {
      return Math.floor(n);
    }
  }
  return null;
}

function pickUsageObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (obj.usage && typeof obj.usage === "object") {
    return obj.usage as Record<string, unknown>;
  }
  if (obj.tokenUsage && typeof obj.tokenUsage === "object") {
    return obj.tokenUsage as Record<string, unknown>;
  }
  return obj;
}

/** Extract token counts from a stream-json / Claude-compatible usage object. */
export function parseUsageFields(raw: unknown): Omit<AgentTokenUsage, "model"> | null {
  const usage = pickUsageObject(raw);
  if (!usage) {
    return null;
  }

  const inputTokens =
    asNonNegInt(usage.inputTokens) ??
    asNonNegInt(usage.input_tokens) ??
    asNonNegInt(usage.promptTokens) ??
    asNonNegInt(usage.prompt_tokens);
  const outputTokens =
    asNonNegInt(usage.outputTokens) ??
    asNonNegInt(usage.output_tokens) ??
    asNonNegInt(usage.completionTokens) ??
    asNonNegInt(usage.completion_tokens);
  const cacheReadTokens =
    asNonNegInt(usage.cacheReadTokens) ??
    asNonNegInt(usage.cache_read_tokens) ??
    asNonNegInt(usage.cache_read_input_tokens) ??
    0;
  const cacheWriteTokens =
    asNonNegInt(usage.cacheWriteTokens) ??
    asNonNegInt(usage.cache_write_tokens) ??
    asNonNegInt(usage.cache_creation_input_tokens) ??
    0;

  if (inputTokens == null && outputTokens == null) {
    const totalOnly = asNonNegInt(usage.totalTokens) ?? asNonNegInt(usage.total_tokens);
    if (totalOnly == null) {
      return null;
    }
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: totalOnly,
    };
  }

  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const totalTokens =
    asNonNegInt(usage.totalTokens) ??
    asNonNegInt(usage.total_tokens) ??
    input + output + cacheReadTokens + cacheWriteTokens;

  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

function addUsage(
  acc: Omit<AgentTokenUsage, "model">,
  next: Omit<AgentTokenUsage, "model">,
): Omit<AgentTokenUsage, "model"> {
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    cacheReadTokens: acc.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + next.cacheWriteTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
  };
}

/**
 * Parse Cursor CLI `--output-format stream-json` NDJSON (or Claude-compatible JSONL)
 * and sum per-turn token usage.
 */
export function parseAgentStreamUsage(text: string): AgentTokenUsage | null {
  let model: string | null = null;
  let acc: Omit<AgentTokenUsage, "model"> | null = null;
  let sawResultUsage = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (event.type === "system" && event.subtype === "init") {
      if (typeof event.model === "string" && event.model.trim()) {
        model = event.model.trim();
      }
    }

    const fromEvent = parseUsageFields(event);
    if (!fromEvent) {
      continue;
    }

    // Prefer summing turn-level usage; if we only see a terminal result usage, use that once.
    if (event.type === "result") {
      if (!acc || !sawResultUsage) {
        acc = fromEvent;
        sawResultUsage = true;
      }
      continue;
    }

    if (sawResultUsage) {
      // Already took terminal totals; skip turn events if both exist.
      continue;
    }

    acc = acc ? addUsage(acc, fromEvent) : fromEvent;
  }

  if (!acc) {
    return null;
  }

  return { ...acc, model };
}

export function readAgentStreamUsage(streamLogPath: string): AgentTokenUsage | null {
  if (!existsSync(streamLogPath)) {
    return null;
  }
  try {
    const text = readFileSync(streamLogPath, "utf8");
    return parseAgentStreamUsage(text);
  } catch {
    return null;
  }
}
