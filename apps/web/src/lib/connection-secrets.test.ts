import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decryptSecret,
  encryptSecret,
  resolveConnectionsSecret,
} from "./connection-secrets";

describe("connection-secrets", () => {
  it("round-trips ciphertext with an explicit secret", () => {
    const secret = "test-connections-secret-32chars!!";
    const plain = "AgADsessionstring_example_001";
    const enc = encryptSecret(plain, secret);
    assert.notEqual(enc, plain);
    assert.equal(decryptSecret(enc, secret), plain);
  });

  it("fails closed on tampered payload", () => {
    const secret = "test-connections-secret-32chars!!";
    const enc = encryptSecret("hello", secret);
    assert.throws(() => decryptSecret(enc.slice(0, -2) + "xx", secret));
  });

  it("prefers CONNECTIONS_SECRET over NEXTAUTH_SECRET", () => {
    const prevC = process.env.CONNECTIONS_SECRET;
    const prevN = process.env.NEXTAUTH_SECRET;
    process.env.CONNECTIONS_SECRET = "from-connections";
    process.env.NEXTAUTH_SECRET = "from-nextauth";
    try {
      assert.equal(resolveConnectionsSecret(), "from-connections");
    } finally {
      if (prevC === undefined) delete process.env.CONNECTIONS_SECRET;
      else process.env.CONNECTIONS_SECRET = prevC;
      if (prevN === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = prevN;
    }
  });
});
