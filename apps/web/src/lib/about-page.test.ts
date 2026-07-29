import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAboutRedirectLocale,
  isAboutLocaleEnabled,
  pickAboutLocaleContent,
  aboutSectionLabels,
} from "./about-page";

describe("about-page helpers", () => {
  it("prefers EN for redirect when both enabled", () => {
    assert.equal(resolveAboutRedirectLocale({ enabledEn: true, enabledRu: true }), "en");
  });

  it("falls back to RU", () => {
    assert.equal(resolveAboutRedirectLocale({ enabledEn: false, enabledRu: true }), "ru");
  });

  it("returns null when none enabled", () => {
    assert.equal(resolveAboutRedirectLocale({ enabledEn: false, enabledRu: false }), null);
  });

  it("picks EN fields", () => {
    const c = pickAboutLocaleContent(
      {
        footerLabelEn: "A", footerLabelRu: "Б",
        pageTitleEn: "T", pageTitleRu: "З",
        leadEn: "L", leadRu: "Л",
        productEn: "P", productRu: "П",
        outlookEn: "O", outlookRu: "О",
        collaborationEn: "C", collaborationRu: "С",
      },
      "en",
    );
    assert.equal(c.pageTitle, "T");
    assert.equal(c.collaboration, "C");
  });

  it("returns RU section labels", () => {
    assert.equal(aboutSectionLabels("ru").product, "Продукт");
  });
});
