import { describe, it, expect, vi, afterEach } from "vitest";
import pg from "pg";
import { pinSslMode, SerializingClient, apsPoolConfig } from "../pg-config";

describe("pinSslMode", () => {
  it("rewrites the pg@9-weakening modes to verify-full", () => {
    expect(pinSslMode("postgresql://u:p@h/db?sslmode=require")).toBe("postgresql://u:p@h/db?sslmode=verify-full");
    expect(pinSslMode("postgresql://u:p@h/db?sslmode=prefer")).toBe("postgresql://u:p@h/db?sslmode=verify-full");
    expect(pinSslMode("postgresql://u:p@h/db?sslmode=verify-ca")).toBe("postgresql://u:p@h/db?sslmode=verify-full");
  });

  it("keeps other params and already-explicit modes untouched", () => {
    expect(pinSslMode("postgresql://u:p@h/db?sslmode=require&channel_binding=require")).toBe(
      "postgresql://u:p@h/db?sslmode=verify-full&channel_binding=require",
    );
    expect(pinSslMode("postgresql://u:p@h/db?sslmode=verify-full")).toBe("postgresql://u:p@h/db?sslmode=verify-full");
    expect(pinSslMode("postgresql://u:p@h/db?sslmode=disable")).toBe("postgresql://u:p@h/db?sslmode=disable");
    expect(pinSslMode("postgresql://u:p@h/db")).toBe("postgresql://u:p@h/db");
  });
});

describe("SerializingClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never starts a promise-form query while another is in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    vi.spyOn(pg.Client.prototype, "query").mockImplementation((() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          resolve();
        });
      });
    }) as never);

    const client = new SerializingClient();
    // Fire three concurrently, the way Prisma's interpreter does in a transaction.
    const all = Promise.all([client.query("SELECT 1"), client.query("SELECT 2"), client.query("SELECT 3")]);
    // Drain: only one may be in flight at any point.
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(resolvers.length).toBe(i + 1));
      expect(inFlight).toBe(1);
      resolvers[i]();
    }
    await all;
    expect(maxInFlight).toBe(1);
  });

  it("keeps serving queries after one rejects, and the rejection reaches its caller", async () => {
    const base = vi
      .spyOn(pg.Client.prototype, "query")
      .mockRejectedValueOnce(new Error("boom") as never)
      .mockResolvedValue("ok" as never);

    const client = new SerializingClient();
    const first = client.query("SELECT fail") as Promise<unknown>;
    const second = client.query("SELECT 1") as Promise<unknown>;
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("passes callback-style calls straight through to pg", () => {
    const base = vi.spyOn(pg.Client.prototype, "query").mockReturnValue(undefined as never);
    const client = new SerializingClient();
    const cb = () => {};
    client.query("SELECT 1", cb);
    expect(base).toHaveBeenCalledWith("SELECT 1", cb);
  });
});

describe("apsPoolConfig", () => {
  it("pins sslmode, installs the serializing client, and merges tuning", () => {
    const cfg = apsPoolConfig("postgresql://u:p@h/db?sslmode=require", { max: 5, keepAlive: true });
    expect(cfg.connectionString).toBe("postgresql://u:p@h/db?sslmode=verify-full");
    expect(cfg.Client).toBe(SerializingClient);
    expect(cfg.max).toBe(5);
    expect(cfg.keepAlive).toBe(true);
  });
});
