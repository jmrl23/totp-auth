import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function client(res: Response | (() => Promise<Response>), onUnauthorized = vi.fn()) {
  const respond = typeof res === "function" ? res : async () => res;
  const fetch = vi.fn((input: string, init?: RequestInit) => {
    void input;
    void init;
    return respond();
  });
  return { api: createApi({ fetch, onUnauthorized }), fetch, onUnauthorized };
}

describe("api", () => {
  it("sends JSON with same-origin credentials and validates responses", async () => {
    const { api, fetch } = client(new Response(null, { status: 204 }));
    await expect(api.login({ username: "alice", authKey: "a".repeat(43) })).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ username: "alice", authKey: "a".repeat(43) });
  });

  it("maps an ApiErrorBody to ApiError with retryAfter", async () => {
    const { api } = client(json(429, { error: { code: "rate_limited", message: "Slow down.", retryAfter: 42 } }));
    const err = await api.prelogin({ username: "alice" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: "rate_limited", message: "Slow down.", retryAfter: 42 });
  });

  it("falls back to the Retry-After header and a generic message without a body", async () => {
    const { api } = client(new Response("busy", { status: 429, headers: { "Retry-After": "7" } }));
    await expect(api.getAuthConfig()).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 7 });
    const { api: api2 } = client(new Response("<html>", { status: 502 }));
    await expect(api2.getAuthConfig()).rejects.toMatchObject({ status: 502, code: "server_error" });
  });

  it("maps network failures to code 'network' with a friendly message", async () => {
    const { api } = client(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.getTime()).rejects.toMatchObject({ status: 0, code: "network", message: expect.stringMatching(/reach the server/) });
  });

  it("rethrows aborts untouched", async () => {
    const { api } = client(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await expect(api.getVault()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects responses that do not match the schema", async () => {
    const { api } = client(json(200, { now: "soon" }));
    await expect(api.getTime()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("signals unauthorized only for authenticated calls with code unauthorized", async () => {
    const body = { error: { code: "unauthorized", message: "Sign in again." } };
    const a = client(json(401, body));
    await expect(a.api.getVault()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(a.onUnauthorized).toHaveBeenCalledTimes(1);

    const b = client(json(401, { error: { code: "invalid_credentials", message: "Wrong username or password." } }));
    await expect(b.api.unlock({ authKey: "a".repeat(43) })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(b.onUnauthorized).not.toHaveBeenCalled();

    const c = client(json(401, body));
    await expect(c.api.login({ username: "alice", authKey: "a".repeat(43) })).rejects.toBeInstanceOf(ApiError);
    expect(c.onUnauthorized).not.toHaveBeenCalled();
  });

  it("handles 204 responses and encodes ids in paths", async () => {
    const { api, fetch } = client(new Response(null, { status: 204 }));
    await expect(api.deleteEntry("0f8fad5b-d9cb-469f-a165-70867728950e")).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe("/api/vault/entries/0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("posts the recovery endpoints and surfaces closedReason", async () => {
    const key = "ABCDE-FGHJK-MNPQR-STVWX";
    const reg = client(json(201, { recoveryKey: key }));
    await expect(
      reg.api.register({
        username: "alice",
        authKey: "a".repeat(43),
        kdfSalt: "s".repeat(22),
        kdfParams: { alg: "argon2id", m: 65536, t: 3, p: 1, v: 1 },
      }),
    ).resolves.toEqual({ recoveryKey: key });
    expect(reg.fetch.mock.calls[0][0]).toBe("/api/auth/register");
    const rec = client(json(200, { recoveryKey: key }));
    await expect(
      rec.api.recover({
        username: "alice",
        recoveryKey: key,
        newAuthKey: "a".repeat(43),
        newKdfSalt: "s".repeat(22),
        newKdfParams: { alg: "argon2id", m: 65536, t: 3, p: 1, v: 1 },
      }),
    ).resolves.toEqual({ recoveryKey: key });
    expect(rec.fetch.mock.calls[0][0]).toBe("/api/auth/recover");
    const regen = client(json(200, { recoveryKey: key }));
    await expect(regen.api.regenerateRecoveryKey({ authKey: "a".repeat(43) })).resolves.toEqual({ recoveryKey: key });
    expect(regen.fetch.mock.calls[0][0]).toBe("/api/account/recovery-key");
    const cfg = client(json(200, { registrationOpen: false, setupTokenRequired: false, closedReason: "closed" }));
    await expect(cfg.api.getAuthConfig()).resolves.toMatchObject({ closedReason: "closed" });
  });

  it("gives friendly defaults for payload_too_large and server_error", async () => {
    const a = client(new Response("too big", { status: 413 }));
    await expect(a.api.importEntries({ entries: [] })).rejects.toMatchObject({
      code: "payload_too_large",
      message: expect.stringMatching(/too much data/),
    });
    const b = client(json(500, { error: { code: "server_error", message: "" } }));
    await expect(b.api.getAuthConfig()).rejects.toMatchObject({ code: "server_error", message: expect.stringMatching(/server had a problem/) });
  });
});
