import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authCallbackUrl,
  buildAuthProvidersFromResolved,
  GOOGLE_OIDC_ISSUER,
  resolveEnvAuthProviders,
  resolveOidcIssuer,
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

  it("treats Google env bootstrap as OIDC with Google issuer", () => {
    const resolved = resolveEnvAuthProviders({
      OIDC_ISSUER: "https://idp.example.com",
      OIDC_CLIENT_ID: "oidc-id",
      OIDC_CLIENT_SECRET: "oidc-secret",
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
    });
    assert.equal(resolved.length, 2);
    assert.equal(resolved[1]?.id, "google");
    assert.equal(resolved[1]?.issuer, GOOGLE_OIDC_ISSUER);
  });

  it("ignores legacy Yandex env (not OIDC)", () => {
    const resolved = resolveEnvAuthProviders({
      YANDEX_CLIENT_ID: "y",
      YANDEX_CLIENT_SECRET: "ys",
    } as Record<string, string>);
    assert.deepEqual(resolved, []);
  });

  it("defaults blank Google issuer by provider id", () => {
    assert.equal(resolveOidcIssuer("google", ""), GOOGLE_OIDC_ISSUER);
    assert.equal(resolveOidcIssuer("oidc", ""), "");
    assert.equal(resolveOidcIssuer("oidc", " https://a.example/ "), "https://a.example");
  });

  it("builds Auth.js OIDC providers for any issuer list", () => {
    const providers = buildAuthProvidersFromResolved([
      {
        id: "company",
        name: "Company login",
        clientId: "c",
        clientSecret: "s",
        issuer: "https://idp.example.com",
      },
      {
        id: "google",
        name: "Google",
        clientId: "g",
        clientSecret: "gs",
        issuer: GOOGLE_OIDC_ISSUER,
      },
    ]);
    assert.equal(providers.length, 2);
    const custom = providers[0] as { id?: string; type?: string };
    const google = providers[1] as { id?: string; type?: string; issuer?: string };
    assert.equal(custom.id, "company");
    assert.equal(custom.type, "oidc");
    assert.equal(google.type, "oidc");
    assert.equal(google.issuer, GOOGLE_OIDC_ISSUER);
  });

  it("builds callback URLs", () => {
    assert.equal(
      authCallbackUrl("https://n.example.com/", DEFAULT_OIDC_PROVIDER_ID),
      "https://n.example.com/api/auth/callback/oidc",
    );
  });
});
