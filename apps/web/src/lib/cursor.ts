import { spawn } from "node:child_process";

export type SpawnAgentResult =
  | { ok: true; pid: number }
  | { ok: false; error: string };

export function resolveCursorCliPath(): string {
  return process.env.CURSOR_CLI_PATH?.trim() || "agent";
}

export function spawnAgent(prompt: string): SpawnAgentResult {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "CURSOR_API_KEY is not configured." };
  }

  const command = resolveCursorCliPath();

  try {
    const child = spawn(command, ["-p", "--trust", "--approve-mcps", prompt], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CURSOR_API_KEY: apiKey,
      },
    });

    child.unref();

    if (!child.pid) {
      return { ok: false, error: "Failed to spawn Cursor CLI agent." };
    }

    child.on("error", () => {
      // Detached spawn errors surface synchronously when pid is missing.
    });

    return { ok: true, pid: child.pid };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to spawn Cursor CLI agent.";
    return { ok: false, error: message };
  }
}
