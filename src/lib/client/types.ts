/**
 * Client library public surface (types only). The client-lib agent implements these in
 * sibling files and re-exports everything from ./index.ts. The UI imports only from "@/lib/client".
 */
import type { EntryPlain, VaultEntry, KdfParams } from "@/lib/schemas";

export type LockState = "checking" | "signed-out" | "locked" | "unlocked";

export type CodeResult = {
  /** Raw digits, e.g. "482913" */
  code: string;
  /** Grouped for display: "482 913" (6) | "4829 1305" (8) | "482 9130" (7: 3+4) */
  formatted: string;
  /** Whole seconds until rotation, 1..period (never 0) */
  secondsLeft: number;
  /** 0..1 fraction of the period elapsed (for the sweep clock) */
  elapsed: number;
  /** secondsLeft <= 5 */
  expiring: boolean;
};

export type ParsedImport = {
  entries: EntryPlain[];
  /** One message per input line that could not be used, with its 1-based line number. */
  errors: { line: number; message: string }[];
  /** Entries dropped because an identical issuer+label+secret already exists in the vault. */
  duplicates: number;
};

export type DerivedKeys = { authKey: string; vaultKey: CryptoKey };

export type { EntryPlain, VaultEntry, KdfParams };
