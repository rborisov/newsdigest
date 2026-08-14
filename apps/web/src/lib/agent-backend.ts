import { spawnAgent, type SpawnAgentResult } from "@/lib/cursor";

export type AgentBackendKind = "cursor" | "burst_gpu";

export type AgentSpawnInput = {
  prompt: string;
  jobId: string;
  stepId?: string;
};

export interface AgentBackend {
  kind: AgentBackendKind;
  spawn(input: AgentSpawnInput): SpawnAgentResult;
}

const BURST_GPU_NOT_IMPLEMENTED =
  "burst_gpu agent backend is not implemented yet (Phase 3+). Set AGENT_BACKEND=cursor or leave unset.";

export function resolveAgentBackendKind(
  override?: string | null,
): AgentBackendKind {
  const raw = (override ?? process.env.AGENT_BACKEND ?? "cursor").trim().toLowerCase();
  if (raw === "burst_gpu" || raw === "burst") {
    return "burst_gpu";
  }
  return "cursor";
}

const cursorBackend: AgentBackend = {
  kind: "cursor",
  spawn(input) {
    return spawnAgent(input.prompt, input.jobId, input.stepId);
  },
};

const burstGpuBackend: AgentBackend = {
  kind: "burst_gpu",
  spawn() {
    return { ok: false, error: BURST_GPU_NOT_IMPLEMENTED };
  },
};

export function createAgentBackend(kind?: AgentBackendKind): AgentBackend {
  return resolveAgentBackendKind(kind) === "burst_gpu" ? burstGpuBackend : cursorBackend;
}

/** Route agent spawn to the configured backend (default: Cursor on VPS). */
export function spawnAgentBackend(
  prompt: string,
  jobId: string,
  stepId?: string,
  kind?: AgentBackendKind,
): SpawnAgentResult {
  return createAgentBackend(kind).spawn({ prompt, jobId, stepId });
}
