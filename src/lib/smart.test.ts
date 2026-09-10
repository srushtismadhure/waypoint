import { afterEach, describe, expect, test } from "bun:test";
import {
  buildSmartSessionCookie,
  consumePendingSmartLaunch,
  createPendingSmartLaunch,
  createPkcePair,
  createSmartSession,
  getSmartClientId,
  normalizeSmartIssuer,
} from "./smart";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("SMART foundations", () => {
  test("normalizes a public HTTPS issuer", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SMART_ALLOWED_ISSUERS;
    expect(normalizeSmartIssuer("https://example.org/fhir/")).toBe("https://example.org/fhir");
  });

  test("rejects non-HTTPS issuer in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => normalizeSmartIssuer("http://example.org/fhir")).toThrow("HTTPS");
  });

  test("honors SMART_ALLOWED_ISSUERS", () => {
    process.env.NODE_ENV = "production";
    process.env.SMART_ALLOWED_ISSUERS = "https://allowed.example/fhir";
    expect(normalizeSmartIssuer("https://allowed.example/fhir/")).toBe("https://allowed.example/fhir");
    expect(() => normalizeSmartIssuer("https://other.example/fhir")).toThrow("SMART_ALLOWED_ISSUERS");
  });

  test("creates PKCE verifier and SHA-256 challenge", () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(first.verifier.length).toBeGreaterThan(43);
    expect(first.challenge.length).toBeGreaterThan(40);
    expect(first.verifier).not.toBe(second.verifier);
  });

  test("pending launch state is one-time", () => {
    const pending = createPendingSmartLaunch({
      issuer: "https://example.org/fhir",
      launch: "launch-123",
      vendor: "generic",
      clientId: "client-123",
      redirectUri: "https://waypoint.example/smart/callback",
      authorizationEndpoint: "https://example.org/auth",
      tokenEndpoint: "https://example.org/token",
      codeVerifier: "verifier",
    });
    expect(consumePendingSmartLaunch(pending.state)?.launch).toBe("launch-123");
    expect(consumePendingSmartLaunch(pending.state)).toBeNull();
  });

  test("uses vendor-specific client ID with generic fallback", () => {
    process.env.EPIC_CLIENT_ID = "epic-client";
    process.env.ORACLE_CLIENT_ID = "oracle-client";
    process.env.SMART_CLIENT_ID = "generic-client";
    expect(getSmartClientId("https://example.org", "epic")).toBe("epic-client");
    expect(getSmartClientId("https://example.org", "oracle")).toBe("oracle-client");
    expect(getSmartClientId("https://example.org", "generic")).toBe("generic-client");
  });

  test("SMART session cookie is HttpOnly and does not contain the OAuth token", () => {
    process.env.NODE_ENV = "production";
    const session = createSmartSession("https://example.org/fhir", {
      access_token: "super-secret-token",
      token_type: "Bearer",
      expires_in: 3600,
      patient: "patient-123",
    });
    const cookie = buildSmartSessionCookie(session);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("super-secret-token");
  });
});
