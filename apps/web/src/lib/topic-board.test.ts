import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardToNavItems, selectBoardPages } from "./topic-board";

describe("selectBoardPages", () => {
  const topics = [
    { id: "t1", name: "AI", sortOrder: 0 },
    { id: "t2", name: "Ops", sortOrder: 1 },
  ];
  const now = new Date("2026-07-29T12:00:00Z");

  it("keeps latest in-window page per topic", () => {
    const board = selectBoardPages(
      [
        { id: "p1", topicId: "t1", topicName: "AI", title: "A1", telegraphUrl: "u1", publishedAt: new Date("2026-07-29T10:00:00Z"), storyTitles: ["s"], htmlContent: "<p>one</p>" },
        { id: "p0", topicId: "t1", topicName: "AI", title: "A0", telegraphUrl: "u0", publishedAt: new Date("2026-07-28T10:00:00Z"), storyTitles: [], htmlContent: "" },
        { id: "p2", topicId: "t2", topicName: "Ops", title: "O", telegraphUrl: "u2", publishedAt: new Date("2026-07-29T09:00:00Z"), storyTitles: [], htmlContent: "<p>ops</p>" },
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
      [{ id: "p0", topicId: "t1", topicName: "AI", title: "Old", telegraphUrl: "u", publishedAt: new Date("2026-07-27T12:00:00Z"), storyTitles: [], htmlContent: "" }],
      topics,
      1,
      now,
    );
    assert.equal(board.length, 0);
  });

  it("keeps cached topics of any age when staleDays is 0", () => {
    const board = selectBoardPages(
      [
        { id: "p0", topicId: "t1", topicName: "AI", title: "Weekly", telegraphUrl: "u", publishedAt: new Date("2026-07-01T12:00:00Z"), storyTitles: ["s"], htmlContent: "<p>cached</p>" },
        { id: "p2", topicId: "t2", topicName: "Ops", title: "O", telegraphUrl: "u2", publishedAt: new Date("2026-07-20T09:00:00Z"), storyTitles: [], htmlContent: "<p>ops</p>" },
      ],
      topics,
      0,
      now,
    );
    assert.equal(board.length, 2);
    // Newest publishedAt first (Ops July 20, then AI July 1).
    assert.equal(board[0]?.pageId, "p2");
    assert.equal(board[1]?.pageId, "p0");
  });

  it("orders board cards by publishedAt descending", () => {
    const board = selectBoardPages(
      [
        {
          id: "p-old",
          topicId: "t1",
          topicName: "AI",
          title: "Old",
          telegraphUrl: "u1",
          publishedAt: new Date("2026-07-28T10:00:00Z"),
          storyTitles: [],
          htmlContent: "",
        },
        {
          id: "p-new",
          topicId: "t2",
          topicName: "Ops",
          title: "New",
          telegraphUrl: "u2",
          publishedAt: new Date("2026-07-29T11:00:00Z"),
          storyTitles: [],
          htmlContent: "",
        },
      ],
      topics,
      0,
      now,
    );
    assert.equal(board[0]?.pageId, "p-new");
    assert.equal(board[1]?.pageId, "p-old");
  });
});

describe("boardToNavItems", () => {
  it("sorts cached topics by publishedAt descending", () => {
    const nav = boardToNavItems([
      {
        topicId: "t1",
        topicName: "AI",
        pageId: "p1",
        title: "A",
        telegraphUrl: "u1",
        publishedAt: new Date("2026-07-01T12:00:00Z"),
        storyTitles: [],
        htmlContent: "",
      },
      {
        topicId: "t2",
        topicName: "Ops",
        pageId: "p2",
        title: "O",
        telegraphUrl: "u2",
        publishedAt: new Date("2026-07-28T09:00:00Z"),
        storyTitles: [],
        htmlContent: "",
      },
    ]);
    assert.equal(nav.length, 2);
    assert.equal(nav[0]?.topicName, "Ops");
    assert.equal(nav[1]?.topicName, "AI");
  });
});
