import path from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync, createWriteStream } from "node:fs";

const DEFAULT_HOST_LOG_DIR = "/opt/newsdigest/data/logs";

export function resolveJobLogDir(): string {
  const fromEnv = process.env.JOB_LOG_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const fileMatch = /^file:(.+)$/.exec(databaseUrl);
  if (fileMatch?.[1]) {
    const dbPath = fileMatch[1];
    // Relative file:./dev.db under standalone cwd is useless for logs — prefer host default.
    if (path.isAbsolute(dbPath)) {
      return path.join(path.dirname(dbPath), "logs");
    }
  }

  if (existsSync("/opt/newsdigest/data")) {
    return DEFAULT_HOST_LOG_DIR;
  }

  return path.join(process.cwd(), "data", "logs");
}

export function jobLogPath(jobId: string, stepId?: string): string {
  const dir = resolveJobLogDir();
  if (stepId) {
    return path.join(dir, `${jobId}-step-${stepId}.log`);
  }
  return path.join(dir, `${jobId}.log`);
}

/** NDJSON from Cursor CLI `--output-format stream-json` (token usage + events). */
export function agentStreamLogPath(jobId: string, stepId?: string): string {
  return `${jobLogPath(jobId, stepId)}.stream.jsonl`;
}

export function ensureJobLogDir(): string {
  const dir = resolveJobLogDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function appendJobLogLine(jobId: string, message: string, stepId?: string): void {
  try {
    ensureJobLogDir();
    const line = `[${new Date().toISOString()}] ${message}\n`;
    appendFileSync(jobLogPath(jobId, stepId), line, "utf8");
    if (stepId) {
      appendFileSync(jobLogPath(jobId), line, "utf8");
    }
  } catch {
    // Logging must never break generation.
  }
}

/** Last `maxLines` of a job (or step) log (empty string if missing). */
export function readJobLogTail(jobId: string, maxLines = 80, stepId?: string): string {
  const file = jobLogPath(jobId, stepId);
  if (!existsSync(file)) {
    return "";
  }

  try {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    return lines.slice(-maxLines).join("\n").trimEnd();
  } catch {
    return "";
  }
}

export function openJobLogWriteStream(jobId: string, stepId?: string) {
  ensureJobLogDir();
  const file = jobLogPath(jobId, stepId);
  return createWriteStream(file, { flags: "a" });
}
