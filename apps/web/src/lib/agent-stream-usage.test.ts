import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAgentStreamUsage, parseUsageFields } from "./agent-stream-usage";

describe("parseUsageFields", () => {
  it("reads camelCase and snake_case token fields", () => {
    assert.deepEqual(
      parseUsageFields({
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
      }),
      {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        totalTokens: 17,
      },
    );

    assert.deepEqual(
      parseUsageFields({
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 1,
        },
      }),
      {
        inputTokens: 3,
        outputTokens: 2,
        cacheReadTokens: 5,
        cacheWriteTokens: 1,
        totalTokens: 11,
      },
    );
  });
});

describe("parseAgentStreamUsage", () => {
  it("sums per-turn usage and keeps model from init", () => {
    const text = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        model: "Composer",
        session_id: "s1",
      }),
      JSON.stringify({
        type: "assistant",
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0 },
      }),
      JSON.stringify({
        type: "assistant",
        usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2 },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStreamUsage(text), {
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 15,
      cacheWriteTokens: 2,
      totalTokens: 197,
      model: "Composer",
    });
  });

  it("prefers terminal result usage when present", () => {
    const text = [
      JSON.stringify({
        type: "assistant",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: {
          inputTokens: 200,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 240,
        },
      }),
    ].join("\n");

    assert.deepEqual(parseAgentStreamUsage(text), {
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 240,
      model: null,
    });
  });

  it("returns null when no usage events exist", () => {
    assert.equal(
      parseAgentStreamUsage('{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n'),
      null,
    );
  });
});
