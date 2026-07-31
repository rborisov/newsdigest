import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { measureDir } from "./system-metrics";

describe("measureDir", () => {
  it("sums nested file sizes", () => {
    const root = path.join(os.tmpdir(), `nd-measure-${Date.now()}`);
    mkdirSync(path.join(root, "a"), { recursive: true });
    writeFileSync(path.join(root, "a", "one.txt"), "hello");
    writeFileSync(path.join(root, "two.txt"), "world!");

    const measured = measureDir(root);
    assert.equal(measured.exists, true);
    assert.equal(measured.fileCount, 2);
    assert.equal(measured.bytes, Buffer.byteLength("hello") + Buffer.byteLength("world!"));

    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty for missing dirs", () => {
    const measured = measureDir(path.join(os.tmpdir(), `nd-missing-${Date.now()}`));
    assert.equal(measured.exists, false);
    assert.equal(measured.bytes, 0);
    assert.equal(measured.fileCount, 0);
  });
});
