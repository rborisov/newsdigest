import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

import { ensureJobLogDir, jobLogPath } from "./job-logs";

export type SpawnAgentResult =
  | { ok: true; pid: number; logPath: string }
  | { ok: false; error: string };

export function resolveCursorCliPath(): string {
  return process.env.CURSOR_CLI_PATH?.trim() || "agent";
}

/**
 * Run Cursor CLI under a bash wrapper that:
 * - appends stdout/stderr to the job log (line-buffered when stdbuf exists)
 * - writes a heartbeat every 15s so Admin can show the job is alive even when
 *   `agent -p` prints little until the end
 */
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
      `[${new Date().toISOString()}] preparing agent for job ${jobId}\n` +
        `[${new Date().toISOString()}] log file: ${logPath}\n` +
        `[${new Date().toISOString()}] cli: ${command}\n`,
      { flag: "a" },
    );

    const wrapper = `
set +e
LOG="\$ND_JOB_LOG"
AGENT_BIN="\$ND_AGENT_BIN"
PROMPT="\$ND_AGENT_PROMPT"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

{
  echo "[\$(ts)] wrapper start"
  echo "[\$(ts)] launching agent (print mode; may be quiet until near the end)"
} >>"\$LOG"

if command -v stdbuf >/dev/null 2>&1; then
  stdbuf -oL -eL "\$AGENT_BIN" -p --trust --approve-mcps "\$PROMPT" >>"\$LOG" 2>&1 &
else
  "\$AGENT_BIN" -p --trust --approve-mcps "\$PROMPT" >>"\$LOG" 2>&1 &
fi
pid=\$!
echo "[\$(ts)] agent pid=\$pid" >>"\$LOG"

while kill -0 "\$pid" 2>/dev/null; do
  echo "[\$(ts)] heartbeat: agent still running (pid=\$pid)" >>"\$LOG"
  sleep 15
done

wait "\$pid"
code=\$?
echo "[\$(ts)] agent exited with code=\$code" >>"\$LOG"
exit "\$code"
`.trim();

    const child = spawn("/bin/bash", ["-c", wrapper], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CURSOR_API_KEY: apiKey,
        ND_JOB_LOG: logPath,
        ND_AGENT_BIN: command,
        ND_AGENT_PROMPT: prompt,
      },
    });

    child.unref();

    if (!child.pid) {
      return { ok: false, error: "Failed to spawn Cursor CLI agent wrapper." };
    }

    writeFileSync(
      logPath,
      `[${new Date().toISOString()}] wrapper pid=${child.pid}\n`,
      { flag: "a" },
    );

    child.on("error", (error) => {
      try {
        writeFileSync(
          logPath,
          `[${new Date().toISOString()}] wrapper error: ${error.message}\n`,
          { flag: "a" },
        );
      } catch {
        // ignore
      }
    });

    return { ok: true, pid: child.pid, logPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to spawn Cursor CLI agent.";
    return { ok: false, error: message };
  }
}
