import { describe, expect, it } from "vitest";
import type { EntryPlain } from "@/lib/schemas";
import { exportEntries, parseImportText } from "./import-export";

const S1 = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const S2 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const a: EntryPlain = { issuer: "ACME", label: "alice", secret: S1, algorithm: "SHA1", digits: 6, period: 30 };
const b: EntryPlain = { issuer: "Globex", label: "bob", secret: S2, algorithm: "SHA256", digits: 8, period: 60 };

describe("exportEntries", () => {
  it("writes one otpauth URI per line and roundtrips through import", () => {
    const text = exportEntries([a, b]);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
    expect(text.split("\n").every((l) => l === "" || l.startsWith("otpauth://totp/"))).toBe(true);
    expect(parseImportText(text, [])).toEqual({ entries: [a, b], errors: [], duplicates: 0 });
  });
  it("is empty for no entries", () => {
    expect(exportEntries([])).toBe("");
  });
});

describe("parseImportText", () => {
  it("tolerates CRLF, blank lines, comments, BOM and surrounding spaces", () => {
    const text = `﻿# my codes\r\n\r\n  otpauth://totp/ACME:alice?secret=${S1}  \r\n\r\notpauth://totp/Globex:bob?secret=${S2}&algorithm=SHA256&digits=8&period=60\r\n`;
    const r = parseImportText(text, []);
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual([a, b]);
  });

  it("reports per-line errors with 1-based line numbers", () => {
    const text = [
      `otpauth://totp/ACME:alice?secret=${S1}`,
      "not a link",
      "",
      `otpauth://hotp/X:y?secret=${S1}&counter=0`,
      `otpauth://totp/X:y?secret=${S1}&digits=12`,
    ].join("\n");
    const r = parseImportText(text, []);
    expect(r.entries).toEqual([a]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 4, 5]);
    expect(r.errors[0].message).toMatch(/otpauth/);
    expect(r.errors[1].message).toMatch(/HOTP/);
    expect(r.errors[2].message).toMatch(/digits/);
  });

  it("drops duplicates of existing entries and within the file", () => {
    const text = [
      `otpauth://totp/ACME:alice?secret=${S1.toLowerCase()}`, // same as existing (secret normalised)
      `otpauth://totp/Globex:bob?secret=${S2}`,
      `otpauth://totp/Globex:bob?secret=${S2}`,
      `otpauth://totp/Globex:carol?secret=${S2}`, // different label: kept
    ].join("\n");
    const r = parseImportText(text, [a]);
    expect(r.duplicates).toBe(2);
    expect(r.entries.map((e) => e.label)).toEqual(["bob", "carol"]);
  });
});

describe("sortEntries", async () => {
  const { sortEntries } = await import("./queries");
  it("sorts by issuer then label, case-insensitive and numeric-aware", () => {
    const rows = [
      { issuer: "beta", label: "b" },
      { issuer: "Alpha", label: "z" },
      { issuer: "alpha", label: "A" },
      { issuer: "Service 10", label: "" },
      { issuer: "Service 9", label: "" },
    ];
    expect(sortEntries(rows).map((r) => `${r.issuer}/${r.label}`)).toEqual([
      "alpha/A",
      "Alpha/z",
      "beta/b",
      "Service 9/",
      "Service 10/",
    ]);
  });
});
