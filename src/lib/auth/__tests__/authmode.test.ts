import { describe, it, expect } from "vitest";
import { resolveAuthMode, type AuthEnv } from "../mode";

/**
 * "Golden test 27": auth-mode resolution is FAIL-CLOSED. Dev auth can never
 * activate in a deployed environment; missing keys in a deployed environment
 * crash instead of degrading.
 */

function env(overrides: Partial<AuthEnv>): AuthEnv {
  return {
    nodeEnv: "development",
    vercel: undefined,
    ci: undefined,
    allowDevAuth: undefined,
    publishableKey: undefined,
    secretKey: undefined,
    ...overrides,
  };
}

const KEYS = { publishableKey: "pk_test_x", secretKey: "sk_test_x" };

describe("auth mode resolution — fail-closed matrix", () => {
  it("keys present → clerk mode, regardless of environment", () => {
    expect(resolveAuthMode(env({ ...KEYS }))).toBe("clerk");
    expect(resolveAuthMode(env({ ...KEYS, nodeEnv: "production", vercel: "1" }))).toBe("clerk");
    expect(resolveAuthMode(env({ ...KEYS, ci: "true" }))).toBe("clerk");
    // Even with the dev flag set, keys win.
    expect(resolveAuthMode(env({ ...KEYS, allowDevAuth: "true" }))).toBe("clerk");
  });

  it("dev mode requires development + explicit flag + not deployed", () => {
    expect(resolveAuthMode(env({ nodeEnv: "development", allowDevAuth: "true" }))).toBe("dev");
  });

  it("no keys in a deployed environment → crash, never degrade", () => {
    expect(() => resolveAuthMode(env({ nodeEnv: "production" }))).toThrow(/deployed/i);
    expect(() => resolveAuthMode(env({ vercel: "1", allowDevAuth: "true" }))).toThrow(/deployed/i);
    expect(() => resolveAuthMode(env({ ci: "true", allowDevAuth: "true" }))).toThrow(/deployed/i);
    // ALLOW_DEV_AUTH cannot enable dev auth in production even off-Vercel.
    expect(() => resolveAuthMode(env({ nodeEnv: "production", allowDevAuth: "true" }))).toThrow(/deployed/i);
  });

  it("no keys, development, but no explicit flag → refuse to start", () => {
    expect(() => resolveAuthMode(env({ nodeEnv: "development" }))).toThrow(/ALLOW_DEV_AUTH/);
    expect(() => resolveAuthMode(env({ nodeEnv: "development", allowDevAuth: "false" }))).toThrow(/ALLOW_DEV_AUTH/);
  });

  it("only one of the two keys → not clerk mode (fail closed, no half-config)", () => {
    expect(() => resolveAuthMode(env({ publishableKey: "pk_test_x", nodeEnv: "production" }))).toThrow();
    expect(() => resolveAuthMode(env({ secretKey: "sk_test_x", vercel: "1" }))).toThrow();
  });

  it("dev cookie is HMAC-signed and rejects tampering", async () => {
    const { createDevCookieValue, verifyDevCookieValue } = await import("../dev");
    const valid = createDevCookieValue("dev:lead");
    expect(verifyDevCookieValue(valid)?.id).toBe("dev:lead");
    expect(verifyDevCookieValue("dev:admin." + valid.split(".")[1])).toBeNull(); // swapped identity
    expect(verifyDevCookieValue("dev:lead.forged")).toBeNull();
    expect(verifyDevCookieValue(undefined)).toBeNull();
    expect(verifyDevCookieValue("garbage")).toBeNull();
  });
});
