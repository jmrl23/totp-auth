import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import type { EntryPlain } from "@/lib/schemas";
import { buildOtpauthUri, formatCode, generateCode, OtpauthError, parseOtpauthUri, parseEntryInput } from "./totp";

const b32 = (ascii: string) => OTPAuth.Secret.fromLatin1(ascii).base32;
const SHA1_SECRET = b32("12345678901234567890");
const SHA256_SECRET = b32("12345678901234567890123456789012");
const SHA512_SECRET = b32("1234567890123456789012345678901234567890123456789012345678901234");

const entry = (over: Partial<EntryPlain>): EntryPlain => ({
  issuer: "RFC",
  label: "test",
  secret: SHA1_SECRET,
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  ...over,
});

describe("generateCode: RFC 6238 vectors (8 digits, 30 s)", () => {
  const table: [number, string, string, string][] = [
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [t, sha1, sha256, sha512] of table) {
    it(`T=${t}`, () => {
      const ms = t * 1000;
      expect(generateCode(entry({ digits: 8 }), ms).code).toBe(sha1);
      expect(generateCode(entry({ digits: 8, algorithm: "SHA256", secret: SHA256_SECRET }), ms).code).toBe(sha256);
      expect(generateCode(entry({ digits: 8, algorithm: "SHA512", secret: SHA512_SECRET }), ms).code).toBe(sha512);
    });
  }
});

describe("generateCode: RFC 4226 HOTP vectors via counter = floor(t / period)", () => {
  const hotp = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  hotp.forEach((code, counter) => {
    it(`counter ${counter}`, () => {
      expect(generateCode(entry({}), counter * 30_000).code).toBe(code);
      // Any period: counter maps the same way.
      expect(generateCode(entry({ period: 60 }), counter * 60_000 + 59_999).code).toBe(code);
    });
  });
});

describe("generateCode timing fields", () => {
  it("secondsLeft is 1..period and never 0", () => {
    expect(generateCode(entry({}), 0).secondsLeft).toBe(30);
    expect(generateCode(entry({}), 29_999).secondsLeft).toBe(1);
    expect(generateCode(entry({}), 29_000).secondsLeft).toBe(1);
    expect(generateCode(entry({}), 28_999).secondsLeft).toBe(2);
    expect(generateCode(entry({}), 30_000).secondsLeft).toBe(30);
  });
  it("elapsed goes 0..1", () => {
    expect(generateCode(entry({}), 0).elapsed).toBe(0);
    expect(generateCode(entry({}), 15_000).elapsed).toBeCloseTo(0.5);
    const e = generateCode(entry({}), 29_999).elapsed;
    expect(e).toBeGreaterThan(0.99);
    expect(e).toBeLessThan(1);
  });
  it("expiring when secondsLeft <= 5", () => {
    expect(generateCode(entry({}), 24_999).expiring).toBe(false); // 6 s left
    expect(generateCode(entry({}), 25_000).expiring).toBe(true); // 5 s left
  });
  it("supports 7 digits", () => {
    expect(generateCode(entry({ digits: 7 }), 59_000).code).toHaveLength(7);
  });
});

describe("formatCode", () => {
  it("groups 6 as 3+3, 7 as 3+4, 8 as 4+4", () => {
    expect(formatCode("482913")).toBe("482 913");
    expect(formatCode("4829130")).toBe("482 9130");
    expect(formatCode("48291305")).toBe("4829 1305");
  });
});

describe("parseOtpauthUri", () => {
  const S = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  it("parses issuer from the query and label prefix", () => {
    const e = parseOtpauthUri(`otpauth://totp/ACME%20Co:alice%40example.com?secret=${S}&issuer=ACME%20Co`);
    expect(e).toEqual({ issuer: "ACME Co", label: "alice@example.com", secret: S, algorithm: "SHA1", digits: 6, period: 30 });
  });
  it("takes the issuer from the label prefix when the param is missing", () => {
    const e = parseOtpauthUri(`otpauth://totp/GitHub:bob?secret=${S}`);
    expect(e.issuer).toBe("GitHub");
    expect(e.label).toBe("bob");
  });
  it("accepts %3A as the label separator and a space after it", () => {
    const e = parseOtpauthUri(`otpauth://totp/Example%3A%20carol?secret=${S}`);
    expect(e.issuer).toBe("Example");
    expect(e.label).toBe("carol");
  });
  it("prefers the issuer param over the label prefix", () => {
    const e = parseOtpauthUri(`otpauth://totp/Old:dave?secret=${S}&issuer=New`);
    expect(e.issuer).toBe("New");
    expect(e.label).toBe("dave");
  });
  it("uses the account as issuer when no issuer exists anywhere", () => {
    const e = parseOtpauthUri(`otpauth://totp/erin%40example.com?secret=${S}`);
    expect(e.issuer).toBe("erin@example.com");
    expect(e.label).toBe("");
  });
  it("handles algorithm, digits, period, lowercase and padded secrets", () => {
    const e = parseOtpauthUri(`OTPAUTH://TOTP/X:y?secret=${S.toLowerCase()}====&algorithm=sha512&digits=8&period=60`);
    expect(e).toMatchObject({ secret: S, algorithm: "SHA512", digits: 8, period: 60 });
    expect(parseOtpauthUri(`otpauth://totp/X:y?secret=${S}&algorithm=SHA-256`).algorithm).toBe("SHA256");
  });
  it("decodes + as a space in the issuer param", () => {
    expect(parseOtpauthUri(`otpauth://totp/a?secret=${S}&issuer=Big+Corp`).issuer).toBe("Big Corp");
  });
  it("trims surrounding whitespace", () => {
    expect(parseOtpauthUri(`  otpauth://totp/X:y?secret=${S}\n`).issuer).toBe("X");
  });

  const bad: [string, RegExp][] = [
    [`otpauth://hotp/X:y?secret=${S}&counter=1`, /HOTP|counter-based/i],
    [`otpauth://steam/X:y?secret=${S}`, /not supported/i],
    [`https://example.com`, /otpauth:\/\//],
    [`otpauth://totp/X:y`, /secret/i],
    [`otpauth://totp/X:y?secret=not*base32!`, /base32/i],
    [`otpauth://totp/X:y?secret=${S}&algorithm=MD5`, /MD5/],
    [`otpauth://totp/X:y?secret=${S}&digits=10`, /digits/i],
    [`otpauth://totp/X:y?secret=${S}&digits=six`, /digits/i],
    [`otpauth://totp/X:y?secret=${S}&period=5`, /period/i],
    [`otpauth://totp/X:y?secret=${S}&period=30.5`, /period/i],
    [`otpauth://totp/%E0%A4%A:y?secret=${S}`, /not encoded correctly/i],
    [``, /otpauth:\/\//],
  ];
  for (const [uri, msg] of bad) {
    it(`rejects ${JSON.stringify(uri.slice(0, 50))}`, () => {
      expect(() => parseOtpauthUri(uri)).toThrow(OtpauthError);
      expect(() => parseOtpauthUri(uri)).toThrow(msg);
    });
  }
});

describe("buildOtpauthUri roundtrip", () => {
  const cases: EntryPlain[] = [
    entry({}),
    entry({ issuer: "ACME Co", label: "alice@example.com", algorithm: "SHA256", digits: 8, period: 60 }),
    entry({ issuer: "Ünïcødé & Söhne", label: "名前+tag/with?odd#chars", digits: 7 }),
    entry({ issuer: "Colon: Inc", label: "x:y" }),
    entry({ issuer: "NoLabel", label: "" }),
    entry({ issuer: "Colon:NoLabel", label: "" }),
    entry({ issuer: "100% legit", label: "a%20b" }),
  ];
  for (const e of cases) {
    it(`${e.issuer} / ${e.label}`, () => {
      const uri = buildOtpauthUri(e);
      expect(uri.startsWith("otpauth://totp/")).toBe(true);
      expect(parseOtpauthUri(uri)).toEqual(e);
    });
  }
  it("produces a URI otpauth itself can parse", () => {
    const e = entry({ issuer: "ACME", label: "alice", algorithm: "SHA512", digits: 8, period: 45 });
    const t = OTPAuth.URI.parse(buildOtpauthUri(e)) as OTPAuth.TOTP;
    expect(t.issuer).toBe("ACME");
    expect(t.label).toBe("alice");
    expect(t.algorithm).toBe("SHA512");
    expect(t.digits).toBe(8);
    expect(t.period).toBe(45);
    expect(t.secret.base32).toBe(e.secret);
  });
});

describe("parseEntryInput", () => {
  it("returns a full entry for URIs", () => {
    const r = parseEntryInput("otpauth://totp/A:b?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
    expect(r.kind).toBe("uri");
  });
  it("returns a normalised secret for raw base32 input", () => {
    expect(parseEntryInput("jbsw y3dp-ehpk 3pxp")).toEqual({ kind: "secret", secret: "JBSWY3DPEHPK3PXP" });
  });
  it("throws a human message for junk", () => {
    expect(() => parseEntryInput("hello world!")).toThrow(OtpauthError);
  });
});
