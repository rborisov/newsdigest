import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encryptSecret } from "@/lib/connection-secrets";
import {
  formatTelegramDisplayName,
  normalizePhone,
  resolveTelegramApiConfig,
  toPublicConnection,
} from "@/lib/telegram-connection";

describe("normalizePhone", () => {
  it("adds + and strips separators", () => {
    assert.equal(normalizePhone("7 (900) 123-45-67"), "+79001234567");
    assert.equal(normalizePhone("+1 415 555 0100"), "+14155550100");
  });

  it("rejects empty or tiny numbers", () => {
    assert.throws(() => normalizePhone("   "), /required/i);
    assert.throws(() => normalizePhone("123"), /short/i);
  });
});

describe("formatTelegramDisplayName", () => {
  it("prefers @username", () => {
    assert.equal(formatTelegramDisplayName({ username: "alice", firstName: "A" }), "@alice");
    assert.equal(formatTelegramDisplayName({ username: "@bob" }), "@bob");
  });

  it("falls back to name then id", () => {
    assert.equal(formatTelegramDisplayName({ firstName: "Ada", lastName: "Lovelace" }), "Ada Lovelace");
    assert.equal(formatTelegramDisplayName({ id: 42 }), "id:42");
  });
});

describe("resolveTelegramApiConfig", () => {
  it("returns null when incomplete", () => {
    assert.equal(resolveTelegramApiConfig({}), null);
    assert.equal(resolveTelegramApiConfig({ TELEGRAM_API_ID: "1" }), null);
    assert.equal(resolveTelegramApiConfig({ TELEGRAM_API_HASH: "abc" }), null);
  });

  it("parses valid id/hash", () => {
    assert.deepEqual(resolveTelegramApiConfig({ TELEGRAM_API_ID: "12345", TELEGRAM_API_HASH: "deadbeef" }), {
      apiId: 12345,
      apiHash: "deadbeef",
    });
  });
});

describe("toPublicConnection", () => {
  it("never exposes session material and surfaces link step", () => {
    process.env.CONNECTIONS_SECRET = "test-secret-for-public-connection";
    const linkStateEnc = encryptSecret(
      JSON.stringify({
        phone: "+10000000000",
        phoneCodeHash: "hash",
        session: "SECRET_SESSION",
        step: "awaiting_code",
        isCodeViaApp: true,
      }),
    );
    const pub = toPublicConnection({
      provider: "telegram",
      status: "linking",
      displayName: "",
      externalId: "",
      lastError: null,
      linkedAt: null,
      linkStateEnc,
    });
    assert.equal(pub.linkStep, "awaiting_code");
    assert.equal(pub.isCodeViaApp, true);
    assert.equal(JSON.stringify(pub).includes("SECRET_SESSION"), false);
    assert.equal(JSON.stringify(pub).includes("hash"), false);
  });
});
