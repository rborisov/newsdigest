import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectBoardPages } from "./topic-board";

describe("selectBoardPages", () => {
  const topics = [
    { id: "t1", name: "AI", sortOrder: 0 },
    { id: "t2", name: "Ops", sortOrder: 1 },
  ];
  const now = new Date("2026-07-29T12:00:00Z");

  it("keeps latest in-window page per topic", () => {
    const board = selectBoardPages(
      [
        { id: "p1", topicId: "t1", topicName: "AI", title: "A1", telegraphUrl: "u1", publishedAt: new Date("2026-07-29T10:00:00Z"), storyTitles: ["s"] },
        { id: "p0", topicId: "t1", topicName: "AI", title: "A0", telegraphUrl: "u0", publishedAt: new Date("2026-07-28T10:00:00Z"), storyTitles: [] },
        { id: "p2", topicId: "t2", topicName: "Ops", title: "O", telegraphUrl: "u2", publishedAt: new Date("2026-07-29T09:00:00Z"), storyTitles: [] },
      ],
      topics,
      1,
      now,
    );
    assert.equal(board.length, 2);
    assert.equal(board[0]?.pageId, "p1");
    assert.equal(board[1]?.pageId, "p2");
  });

  it("drops topics whose latest page is outside stale window", () => {
    const board = selectBoardPages(
      [{ id: "p0", topicId: "t1", topicName: "AI", title: "Old", telegraphUrl: "u", publishedAt: new Date("2026-07-27T12:00:00Z"), storyTitles: [] }],
      topics,
      1,
      now,
    );
    assert.equal(board.length, 0);
  });
});
