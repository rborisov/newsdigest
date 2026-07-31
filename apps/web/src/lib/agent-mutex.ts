import { openSync, writeFileSync, closeSync, unlinkSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function resolveAgentMutexPath(): string {
  return process.env.AGENT_MUTEX_PATH?.trim() || "/var/lock/cursor-agent.lock";
}

export type AgentMutexResult =
  | { ok: true; release: () => void }
  | { ok: false; error: string };

/** Host-wide exclusive lock so newsdigest and verified-tours never run agent in parallel. */
export function tryAcquireAgentMutex(holder: string): AgentMutexResult {
  const mutexPath = resolveAgentMutexPath();
  try {
    mkdirSync(dirname(mutexPath), { recursive: true });
  } catch {
    // ignore
  }

  try {
    const fd = openSync(mutexPath, "wx");
    writeFileSync(
      fd,
      JSON.stringify({
        holder,
        pid: process.pid,
        at: new Date().toISOString(),
      }),
    );
    closeSync(fd);
    return {
      ok: true,
      release: () => {
        try {
          unlinkSync(mutexPath);
        } catch {
          // ignore
        }
      },
    };
  } catch {
    let holderInfo = "unknown";
    try {
      holderInfo = readFileSync(mutexPath, "utf8").trim();
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: `Agent mutex busy (${mutexPath}): ${holderInfo}`,
    };
  }
}

export function releaseAgentMutexBestEffort(): void {
  try {
    unlinkSync(resolveAgentMutexPath());
  } catch {
    // ignore
  }
}
