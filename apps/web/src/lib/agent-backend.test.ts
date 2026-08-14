import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAgentBackend,
  resolveAgentBackendKind,
  spawnAgentBackend,
} from "./agent-backend";

describe("agent-backend", () => {
  it("defaults to cursor", () => {
    assert.equal(resolveAgentBackendKind("cursor"), "cursor");
    assert.equal(resolveAgentBackendKind(undefined), "cursor");
    assert.equal(createAgentBackend("cursor").kind, "cursor");
  });

  it("recognizes burst_gpu aliases", () => {
    assert.equal(resolveAgentBackendKind("burst_gpu"), "burst_gpu");
    assert.equal(resolveAgentBackendKind("burst"), "burst_gpu");
  });

  it("returns not-implemented for burst_gpu spawn", () => {
    const result = spawnAgentBackend("test prompt", "job_test", undefined, "burst_gpu");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /not implemented/i);
    }
  });
});
