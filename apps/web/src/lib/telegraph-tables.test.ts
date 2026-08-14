import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertTablesForTelegraph,
  formatTableAsTelegraphHtml,
  parseTableHtml,
} from "./telegraph-tables";

describe("telegraph-tables", () => {
  it("parses header and body rows", () => {
    const table = `
      <thead><tr><th>Отрасль</th><th>Кол-во</th><th>Бюджет</th></tr></thead>
      <tbody>
        <tr><td>Транспорт</td><td>12</td><td>11,66 млрд ₽</td></tr>
      </tbody>`;
    const parsed = parseTableHtml(table);
    assert.deepEqual(parsed.headers, ["Отрасль", "Кол-во", "Бюджет"]);
    assert.deepEqual(parsed.rows, [["Транспорт", "12", "11,66 млрд ₽"]]);
  });

  it("formats tables as labeled bullet lists", () => {
    const html = formatTableAsTelegraphHtml(
      ["Отрасль", "Кол-во", "Бюджет"],
      [["Транспорт", "12", "11,66 млрд ₽"]],
    );
    assert.match(html, /<ul>/);
    assert.match(html, /<strong>Транспорт<\/strong>/);
    assert.match(html, /<strong>Кол-во:<\/strong> 12/);
    assert.match(html, /11,66 млрд ₽/);
  });

  it("replaces table blocks in HTML", () => {
    const html =
      "<p>Intro</p><table><tr><th>A</th><th>B</th></tr><tr><td>One</td><td>Two</td></tr></table><p>Outro</p>";
    const out = convertTablesForTelegraph(html);
    assert.match(out, /Intro/);
    assert.match(out, /Outro/);
    assert.doesNotMatch(out, /<table/i);
    assert.match(out, /<strong>One<\/strong>/);
    assert.match(out, /<strong>B:<\/strong> Two/);
  });

  it("leaves HTML without tables unchanged", () => {
    const html = "<p>Hello</p><ul><li>Item</li></ul>";
    assert.equal(convertTablesForTelegraph(html), html);
  });
});
