import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyIngestText } from "@/lib/ingest-filter";

describe("classifyIngestText", () => {
  it("keeps factual chat lines", () => {
    assert.equal(
      classifyIngestText("В порту задержали сухогруз с цементом, граница закрыта до вечера."),
      "kept",
    );
  });

  it("flags ads and fluff", () => {
    assert.equal(classifyIngestText("Реклама: только сегодня скидка 50%"), "ads");
    assert.equal(classifyIngestText("🔥🔥🔥"), "fluff");
    assert.equal(classifyIngestText("ok"), "fluff");
  });

  it("flags short questions and service noise", () => {
    assert.equal(classifyIngestText("Кто знает курс?"), "question");
    assert.equal(classifyIngestText("Alice joined the group"), "other");
    assert.equal(classifyIngestText("", { isService: true }), "other");
  });
});
