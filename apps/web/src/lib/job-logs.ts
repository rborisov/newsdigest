import path from "node:path";
import { existsSync, mkdirSync, readFileSync, createWriteStream } from "node:fs";

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

export function jobLogPath(jobId: string): string {
  return path.join(resolveJobLogDir(), `${jobId}.log`);
}

export function ensureJobLogDir(): string {
  const dir = resolveJobLogDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Last `maxLines` of a job log (empty string if missing). */
export function readJobLogTail(jobId: string, maxLines = 80): string {
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
