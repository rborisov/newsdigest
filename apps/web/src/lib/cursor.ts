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
 * - appends stdout/stderr to the job (or step) log
 * - writes a heartbeat every 15s while the agent is alive
 */
export function spawnAgent(
  prompt: string,
  jobId: string,
  stepId?: string,
): SpawnAgentResult {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY is not configured." };
  }

  const command = resolveCursorCliPath();
  const workspace = resolveAgentWorkspace();

  try {
    ensureJobLogDir();
    const logPath = jobLogPath(jobId, stepId);
    const parentLogPath = jobLogPath(jobId);
    writeFileSync(
      logPath,
      `[${new Date().toISOString()}] preparing agent for job ${jobId}` +
        (stepId ? ` step ${stepId}` : "") +
        `\n` +
        `[${new Date().toISOString()}] log file: ${logPath}\n` +
        `[${new Date().toISOString()}] cli: ${command}\n` +
        `[${new Date().toISOString()}] workspace: ${workspace}\n` +
        `[${new Date().toISOString()}] flags: -p --force --sandbox disabled --trust --approve-mcps\n`,
      { flag: "a" },
    );
    if (stepId && logPath !== parentLogPath) {
      writeFileSync(
        parentLogPath,
        `[${new Date().toISOString()}] step ${stepId} agent log → ${logPath}\n`,
        { flag: "a" },
      );
    }

    const wrapper = `
set +e
LOG="\$ND_JOB_LOG"
PARENT_LOG="\$ND_PARENT_LOG"
AGENT_BIN="\$ND_AGENT_BIN"
PROMPT="\$ND_AGENT_PROMPT"
WORKSPACE="\$ND_AGENT_WORKSPACE"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log_both() {
  echo "\$1" >>"\$LOG"
  if [ -n "\$PARENT_LOG" ] && [ "\$PARENT_LOG" != "\$LOG" ]; then
    echo "\$1" >>"\$PARENT_LOG"
  fi
}

{
  log_both "[\$(ts)] wrapper start"
  log_both "[\$(ts)] launching agent (force + sandbox disabled for VPS digest automation)"
}

# --force: required in -p so MCP/shell/fetch are not silently "User rejected"
# --sandbox disabled: default sandbox blocks 127.0.0.1 (portal MCP) and most news sites
AGENT_ARGS=(-p --force --sandbox disabled --trust --approve-mcps --workspace "\$WORKSPACE")

if command -v stdbuf >/dev/null 2>&1; then
  stdbuf -oL -eL "\$AGENT_BIN" "\${AGENT_ARGS[@]}" "\$PROMPT" >>"\$LOG" 2>&1 &
else
  "\$AGENT_BIN" "\${AGENT_ARGS[@]}" "\$PROMPT" >>"\$LOG" 2>&1 &
fi
pid=\$!
log_both "[\$(ts)] agent pid=\$pid"

while kill -0 "\$pid" 2>/dev/null; do
  log_both "[\$(ts)] heartbeat: agent still running (pid=\$pid)"
  sleep 15
done

wait "\$pid"
code=\$?
log_both "[\$(ts)] agent exited with code=\$code"
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
        ND_PARENT_LOG: parentLogPath,
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
