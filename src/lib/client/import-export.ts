/** Plain-text export/import: one otpauth:// URI per line (the format other authenticators use). */
import { normalizeSecret, type EntryPlain } from "@/lib/schemas";
import { buildOtpauthUri, OtpauthError, parseOtpauthUri } from "./totp";
import type { ParsedImport } from "./types";

/** One otpauth:// URI per line, newline-terminated. */
export function exportEntries(entries: EntryPlain[]): string {
  if (entries.length === 0) return "";
  return entries.map(buildOtpauthUri).join("\n") + "\n";
}

const dedupeKey = (e: Pick<EntryPlain, "issuer" | "label" | "secret">) =>
  JSON.stringify([e.issuer.trim(), e.label.trim(), normalizeSecret(e.secret)]);

/**
 * Parse an export file. Blank lines and lines starting with "#" are ignored; CRLF is fine.
 * Entries identical (issuer + label + secret) to one in `existing` or earlier in the file count as duplicates.
 */
export function parseImportText(text: string, existing: Pick<EntryPlain, "issuer" | "label" | "secret">[]): ParsedImport {
  const seen = new Set(existing.map(dedupeKey));
  const entries: EntryPlain[] = [];
  const errors: ParsedImport["errors"] = [];
  let duplicates = 0;
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    try {
      const entry = parseOtpauthUri(line);
      const key = dedupeKey(entry);
      if (seen.has(key)) {
        duplicates++;
        return;
      }
      seen.add(key);
      entries.push(entry);
    } catch (error) {
      const message = error instanceof OtpauthError ? error.message : "This line could not be read.";
      errors.push({ line: index + 1, message });
    }
  });
  return { entries, errors, duplicates };
}

/** Save `text` as a file via a temporary blob link. Browser only. */
export function downloadTextFile(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
