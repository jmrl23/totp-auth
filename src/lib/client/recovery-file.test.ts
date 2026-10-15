import { describe, expect, it } from "vitest";
import { buildRecoveryKeyFile, recoveryKeyFilename } from "./recovery-file";

describe("recovery key file", () => {
  it("names the file after the account in a filename-safe way", () => {
    expect(recoveryKeyFilename("Alice")).toBe("totp-auth-recovery-key-alice.txt");
    expect(recoveryKeyFilename("a/b c")).toBe("totp-auth-recovery-key-a-b-c.txt");
  });

  it("contains the account, instance, date, key and what the key can and cannot do", () => {
    const text = buildRecoveryKeyFile({
      username: "alice",
      recoveryKey: "ABCDE-FGHJK-MNPQR-STVWX",
      origin: "https://auth.example.com",
      now: new Date("2026-10-15T12:00:00Z"),
    });
    expect(text).toContain("Account: alice");
    expect(text).toContain("Instance: https://auth.example.com");
    expect(text).toContain("Issued: 2026-10-15");
    expect(text).toContain("Recovery key: ABCDE-FGHJK-MNPQR-STVWX");
    expect(text).toMatch(/entries are erased/);
    expect(text.endsWith("\n")).toBe(true);
  });
});
