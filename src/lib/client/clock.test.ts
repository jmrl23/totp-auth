import { describe, expect, it } from "vitest";
import { bestOffset, configureClockForTests, getClockOffset, measureOffset, offsetFromSample, syncClock } from "./clock";

describe("clock offset math", () => {
  it("offset = serverNow + rtt/2 - clientNow", () => {
    expect(offsetFromSample({ serverNow: 10_000, rtt: 200, clientNow: 9_000 })).toBe(1_100);
    expect(offsetFromSample({ serverNow: 10_000, rtt: 0, clientNow: 10_000 })).toBe(0);
  });

  it("uses the lowest-rtt sample", () => {
    expect(
      bestOffset([
        { serverNow: 1000, rtt: 500, clientNow: 0 }, // 1250
        { serverNow: 2000, rtt: 40, clientNow: 1000 }, // 1020
        { serverNow: 3000, rtt: 300, clientNow: 2000 }, // 1150
      ]),
    ).toBe(1020);
    expect(bestOffset([])).toBeNull();
  });

  it("measures up to 3 sequential samples with injected time sources", async () => {
    // Client clock is 5 s behind the server; round trips take 300, 100 and 200 ms.
    let clientMs = 1_000_000;
    const rtts = [300, 100, 200];
    let calls = 0;
    const offset = await measureOffset({
      now: () => clientMs,
      monotonic: () => clientMs,
      fetchServerNow: async () => {
        const rtt = rtts[calls++];
        clientMs += rtt / 2;
        const server = clientMs + 5_000;
        clientMs += rtt / 2;
        return server;
      },
    });
    expect(calls).toBe(3);
    expect(offset).toBe(5_000);
  });

  it("skips failed samples and returns null when all fail", async () => {
    let n = 0;
    const ok = await measureOffset({
      now: () => 0,
      monotonic: () => 0,
      fetchServerNow: async () => {
        if (n++ === 0) throw new Error("offline");
        return 700;
      },
    });
    expect(ok).toBe(700);
    const none = await measureOffset({ now: () => 0, fetchServerNow: () => Promise.reject(new Error("x")) });
    expect(none).toBeNull();
  });

  it("syncClock stores the measured offset", async () => {
    configureClockForTests({ now: () => 50_000, fetchServerNow: async () => 52_500 });
    await syncClock();
    expect(getClockOffset()).toBe(2_500);
  });
});
