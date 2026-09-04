import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authCallbackUrl,
  buildAuthProvidersFromResolved,
  effectiveProviderId,
  GOOGLE_OIDC_ISSUER,
  resolveEnvAuthProviders,
  resolveIssuerForKind,
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
    assert.deepEqual(
      resolved.map((r) => r.kind),
      ["oidc", "google"],
    );
    assert.equal(resolved[1]?.issuer, GOOGLE_OIDC_ISSUER);
    assert.equal(resolved[1]?.id, "google");
  });

  it("defaults blank Google issuer to accounts.google.com", () => {
    assert.equal(resolveIssuerForKind("google", ""), GOOGLE_OIDC_ISSUER);
    assert.equal(resolveIssuerForKind("google", " https://accounts.google.com/ "), GOOGLE_OIDC_ISSUER);
    assert.equal(resolveIssuerForKind("oidc", ""), "");
  });

  it("treats schema default providerId oidc as unset for Google slot", () => {
    assert.equal(effectiveProviderId("google", "oidc"), "google");
    assert.equal(effectiveProviderId("google", "google"), "google");
    assert.equal(effectiveProviderId("oidc", "oidc"), "oidc");
    assert.equal(effectiveProviderId("oidc", "company"), "company");
  });

  it("builds Auth.js OIDC providers for both custom and Google slots", () => {
    const providers = buildAuthProvidersFromResolved([
      {
        kind: "oidc",
        id: "company",
        name: "Company login",
        clientId: "c",
        clientSecret: "s",
        issuer: "https://idp.example.com",
      },
      {
        kind: "google",
        id: "google",
        name: "Google",
        clientId: "g",
        clientSecret: "gs",
        issuer: GOOGLE_OIDC_ISSUER,
      },
    ]);
    assert.equal(providers.length, 2);
    const custom = providers[0] as {
      id?: string;
      type?: string;
      allowDangerousEmailAccountLinking?: boolean;
    };
    const google = providers[1] as { id?: string; type?: string; issuer?: string };
    assert.equal(custom.id, "company");
    assert.equal(custom.type, "oidc");
    assert.equal(custom.allowDangerousEmailAccountLinking, true);
    assert.equal(google.type, "oidc");
    assert.equal(google.id, "google");
    assert.equal(google.issuer, GOOGLE_OIDC_ISSUER);
    assert.equal(
      (custom as { authorization?: { params?: { prompt?: string } } }).authorization
        ?.params?.prompt,
      "login",
    );
  });

  it("builds callback URLs", () => {
    assert.equal(
      authCallbackUrl("https://n.example.com/", DEFAULT_OIDC_PROVIDER_ID),
      "https://n.example.com/api/auth/callback/oidc",
    );
    assert.equal(
      authCallbackUrl("https://n.example.com", "google"),
      "https://n.example.com/api/auth/callback/google",
    );
  });
});
