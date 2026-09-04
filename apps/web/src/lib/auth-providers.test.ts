import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authCallbackUrl,
  buildAuthProvidersFromResolved,
  resolveEnvAuthProviders,
  DEFAULT_OIDC_PROVIDER_ID,
} from "./auth-providers";

describe("auth-providers", () => {
  it("requires an explicit issuer for env OIDC", () => {
    assert.deepEqual(
      resolveEnvAuthProviders({
        OIDC_CLIENT_ID: "id",
        OIDC_CLIENT_SECRET: "secret",
      }),
      [],
    );
    const resolved = resolveEnvAuthProviders({
      OIDC_ISSUER: " https://idp.example.com/ ",
      OIDC_CLIENT_ID: "id",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_PROVIDER_NAME: "Company",
    });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.issuer, "https://idp.example.com");
    assert.equal(resolved[0]?.name, "Company");
  });

  it("can enable OIDC and Google together from env", () => {
    const resolved = resolveEnvAuthProviders({
      OIDC_ISSUER: "https://idp.example.com",
      OIDC_CLIENT_ID: "oidc-id",
      OIDC_CLIENT_SECRET: "oidc-secret",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
    });
    assert.equal(resolved.length, 2);
    assert.deepEqual(
      resolved.map((r) => r.kind),
      ["oidc", "google"],
    );
  });

  it("builds Auth.js providers from resolved rows", () => {
    const providers = buildAuthProvidersFromResolved([
      {
        kind: "oidc",
        id: "company",
        name: "Company login",
        clientId: "c",
        clientSecret: "s",
        issuer: "https://idp.example.com",
      },
    ]);
    assert.equal(providers.length, 1);
    const provider = providers[0] as { id?: string; type?: string };
    assert.equal(provider.id, "company");
    assert.equal(provider.type, "oidc");
  });

  it("builds callback URLs", () => {
    assert.equal(
      authCallbackUrl("https://n.example.com/", DEFAULT_OIDC_PROVIDER_ID),
      "https://n.example.com/api/auth/callback/oidc",
    );
  });
});
