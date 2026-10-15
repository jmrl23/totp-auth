"use client";

import { cn } from "@/lib/utils";
import type { VaultEntry } from "@/lib/schemas";
import { EntryRow } from "@/components/vault/entry-row";
import { useCopyHintVisible } from "@/hooks/use-copy-hint";

/** Column header (md+) and the rows. The header uses the same grid as the rows. */
export function EntryList({
  entries,
  onEdit,
  onDelete,
}: {
  entries: VaultEntry[];
  onEdit: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
}) {
  const hintVisible = useCopyHintVisible();
  return (
    <section aria-label="Entries">
      <div aria-hidden="true" className="hidden items-center md:flex">
        <div className="entry-grid h-11 flex-1 pr-2 pl-4 text-[0.9375rem] text-muted-foreground lg:pl-5">
          <span className="ga-clock" />
          <span className="ga-issuer">Issuer</span>
          <span className="ga-account">Account</span>
          <span className="ga-code">
            Code <span className="font-normal">· click a row to copy</span>
          </span>
          <span className="ga-secs">Valid for</span>
        </div>
        <span className="w-13 shrink-0" />
      </div>
      <p className={cn("pad-safe-x pt-2 pb-2 text-sm text-muted-foreground md:sr-only", !hintVisible && "sr-only")}>
        Tap a row to copy its code.
      </p>
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </ul>
    </section>
  );
}
