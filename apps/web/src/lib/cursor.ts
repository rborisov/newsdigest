import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

import { ensureJobLogDir, jobLogPath } from "./job-logs";

export type SpawnAgentResult =
  | { ok: true; pid: number; logPath: string }
  | { ok: false; error: string };

export function resolveCursorCliPath(): string {
  return process.env.CURSOR_CLI_PATH?.trim() || "agent";
}

export function resolveAgentWorkspace(): string {
  return process.env.AGENT_WORKSPACE?.trim() || "/opt/newsdigest";
}

/**
 * Run Cursor CLI under a bash wrapper that:
 * - uses --force + --sandbox disabled so headless runs can fetch news and call MCP
 *   (without --force, -p silently denies shell/fetch/MCP — "environment blocked")
 * - appends stdout/stderr to the job log
 * - writes a heartbeat every 15s while the agent is alive
 */
export function spawnAgent(prompt: string, jobId: string): SpawnAgentResult {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY is not configured." };
  }

  const command = resolveCursorCliPath();
  const workspace = resolveAgentWorkspace();

  try {
    ensureJobLogDir();
    const logPath = jobLogPath(jobId);
    writeFileSync(
      logPath,
      `[${new Date().toISOString()}] preparing agent for job ${jobId}\n` +
        `[${new Date().toISOString()}] log file: ${logPath}\n` +
        `[${new Date().toISOString()}] cli: ${command}\n` +
        `[${new Date().toISOString()}] workspace: ${workspace}\n` +
        `[${new Date().toISOString()}] flags: -p --force --sandbox disabled --trust --approve-mcps\n`,
      { flag: "a" },
    );

    const wrapper = `
set +e
LOG="\$ND_JOB_LOG"
AGENT_BIN="\$ND_AGENT_BIN"
PROMPT="\$ND_AGENT_PROMPT"
WORKSPACE="\$ND_AGENT_WORKSPACE"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

{
  echo "[\$(ts)] wrapper start"
  echo "[\$(ts)] launching agent (force + sandbox disabled for VPS digest automation)"
} >>"\$LOG"

# --force: required in -p so MCP/shell/fetch are not silently "User rejected"
# --sandbox disabled: default sandbox blocks 127.0.0.1 (portal MCP) and most news sites
AGENT_ARGS=(-p --force --sandbox disabled --trust --approve-mcps --workspace "\$WORKSPACE")

if command -v stdbuf >/dev/null 2>&1; then
  stdbuf -oL -eL "\$AGENT_BIN" "\${AGENT_ARGS[@]}" "\$PROMPT" >>"\$LOG" 2>&1 &
else
  "\$AGENT_BIN" "\${AGENT_ARGS[@]}" "\$PROMPT" >>"\$LOG" 2>&1 &
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
        HOME: process.env.HOME || "/root",
        ND_JOB_LOG: logPath,
        ND_AGENT_BIN: command,
        ND_AGENT_PROMPT: prompt,
        ND_AGENT_WORKSPACE: workspace,
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
