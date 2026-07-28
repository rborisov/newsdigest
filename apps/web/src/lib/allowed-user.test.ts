import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getAllowedUserByEmail,
  getIsAdmin,
  isEmailAllowed,
  normalizeEmail,
} from "./allowed-user";

describe("normalizeEmail", () => {
  it("trims and lowercases email addresses", () => {
    assert.equal(normalizeEmail("  Admin@Example.COM  "), "admin@example.com");
  });
});

describe("allowlist helpers", () => {
  const mockClient = {
    allowedUser: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        if (where.email === "admin@example.com") {
          return { email: where.email, isAdmin: true };
        }
        if (where.email === "member@example.com") {
          return { email: where.email, isAdmin: false };
        }
        return null;
      },
    },
  };

  it("allows emails present in AllowedUser", async () => {
    assert.equal(await isEmailAllowed("Admin@Example.COM", mockClient), true);
  });

  it("rejects emails missing from AllowedUser", async () => {
    assert.equal(await isEmailAllowed("unknown@example.com", mockClient), false);
  });

  it("returns isAdmin from AllowedUser", async () => {
    assert.equal(await getIsAdmin("admin@example.com", mockClient), true);
    assert.equal(await getIsAdmin("member@example.com", mockClient), false);
    assert.equal(await getIsAdmin("unknown@example.com", mockClient), false);
  });

  it("normalizes email before lookup", async () => {
    const user = await getAllowedUserByEmail("  ADMIN@example.com ", mockClient);
    assert.equal(user?.isAdmin, true);
  });
});
