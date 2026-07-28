import { openSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

import { ensureJobLogDir, jobLogPath } from "./job-logs";

export type SpawnAgentResult =
  | { ok: true; pid: number; logPath: string }
  | { ok: false; error: string };

export function resolveCursorCliPath(): string {
  return process.env.CURSOR_CLI_PATH?.trim() || "agent";
}

export function spawnAgent(prompt: string, jobId: string): SpawnAgentResult {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY is not configured." };
  }

  const command = resolveCursorCliPath();

  try {
    ensureJobLogDir();
    const logPath = jobLogPath(jobId);
    writeFileSync(
      logPath,
      `[${new Date().toISOString()}] spawning ${command} for job ${jobId}\n`,
      { flag: "a" },
    );
    const logFd = openSync(logPath, "a");

    const child = spawn(command, ["-p", "--trust", "--approve-mcps", prompt], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        CURSOR_API_KEY: apiKey,
      },
    });

    child.unref();

    if (!child.pid) {
      return { ok: false, error: "Failed to spawn Cursor CLI agent." };
    }

    writeFileSync(logPath, `[${new Date().toISOString()}] agent pid=${child.pid}\n`, {
      flag: "a",
    });

    child.on("error", (error) => {
      try {
        writeFileSync(
          logPath,
          `[${new Date().toISOString()}] spawn error: ${error.message}\n`,
          { flag: "a" },
        );
      } catch {
        // ignore log write failures
      }
    });

    return { ok: true, pid: child.pid, logPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to spawn Cursor CLI agent.";
    return { ok: false, error: message };
  }
}
