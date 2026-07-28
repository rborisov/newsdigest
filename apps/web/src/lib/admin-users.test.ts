import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countAdmins, isLastAdmin, LAST_ADMIN_ERROR } from "./admin-users";

describe("admin-users", () => {
  it("exports last-admin error message", () => {
    assert.match(LAST_ADMIN_ERROR, /last admin/i);
  });

  describe("countAdmins", () => {
    it("counts users with isAdmin true", async () => {
      const mockClient = {
        allowedUser: {
          count: async ({ where }: { where: { isAdmin: boolean } }) => {
            assert.equal(where.isAdmin, true);
            return 2;
          },
        },
      };

      assert.equal(await countAdmins(mockClient as never), 2);
    });
  });

  describe("isLastAdmin", () => {
    it("returns false for non-admin users", async () => {
      const mockClient = {
        allowedUser: {
          findUnique: async () => ({ id: "1", isAdmin: false }),
          count: async () => 1,
        },
      };

      assert.equal(await isLastAdmin("1", mockClient as never), false);
    });

    it("returns true when user is the only admin", async () => {
      const mockClient = {
        allowedUser: {
          findUnique: async () => ({ id: "1", isAdmin: true }),
          count: async () => 1,
        },
      };

      assert.equal(await isLastAdmin("1", mockClient as never), true);
    });

    it("returns false when other admins exist", async () => {
      const mockClient = {
        allowedUser: {
          findUnique: async () => ({ id: "1", isAdmin: true }),
          count: async () => 3,
        },
      };

      assert.equal(await isLastAdmin("1", mockClient as never), false);
    });
  });
});
