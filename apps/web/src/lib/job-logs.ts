import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function resolveJobLogDir(): string {
  const fromEnv = process.env.JOB_LOG_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const fileMatch = /^file:(.+)$/.exec(databaseUrl);
  if (fileMatch?.[1]) {
    const dbPath = fileMatch[1];
    return path.join(path.dirname(dbPath), "logs");
  }

  return path.join(process.cwd(), "data", "logs");
}

export function jobLogPath(jobId: string): string {
  return path.join(resolveJobLogDir(), `${jobId}.log`);
}

export function ensureJobLogDir(): string {
  const dir = resolveJobLogDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Last `maxLines` of a job log (empty string if missing). */
export function readJobLogTail(jobId: string, maxLines = 40): string {
  const file = jobLogPath(jobId);
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

export function openJobLogWriteStream(jobId: string) {
  ensureJobLogDir();
  const file = jobLogPath(jobId);
  return createWriteStream(file, { flags: "a" });
}
