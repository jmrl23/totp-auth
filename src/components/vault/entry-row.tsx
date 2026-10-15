"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, EllipsisVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { generateCode, useNow } from "@/lib/client";
import type { VaultEntry } from "@/lib/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SweepClock } from "@/components/vault/sweep-clock";
import { useAnnounce } from "@/hooks/use-announcer";
import { copyText } from "@/hooks/use-copy";
import { markCopyHintDone } from "@/hooks/use-copy-hint";
import { cn } from "@/lib/utils";

type RowProps = {
  entry: VaultEntry;
  onEdit: (entry: VaultEntry) => void;
  onDelete: (entry: VaultEntry) => void;
};

/**
 * One timetable row. Memoised: it renders only when the entry or its handlers change.
 * The live part (clock, code, seconds) is the LiveCode leaf, the only subscriber to the ticker.
 * Static cells are built here and passed down as elements, so ticks never re-render them.
 */
export const EntryRow = memo(function EntryRow({ entry, onEdit, onDelete }: RowProps) {
  const name = entry.label ? `${entry.issuer} (${entry.label})` : entry.issuer;
  const issuer = (
    <span className="ga-issuer truncate text-[1.0625rem] leading-tight font-bold md:text-[1.1875rem] lg:text-[1.375rem]">
      {entry.issuer}
    </span>
  );
  const account = entry.label ? (
    <span className="ga-account line-clamp-2 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere] md:line-clamp-1 md:text-base">
      {entry.label}
    </span>
  ) : (
    <span className="ga-account text-sm text-muted-foreground md:text-base">
      <span aria-hidden="true">&nbsp;</span>
    </span>
  );
  return (
    <li className="relative flex items-stretch bg-row odd:bg-row-alt after:pointer-events-none after:absolute after:inset-0 after:bg-foreground/[0.04] after:opacity-0 hover:after:opacity-100 focus-within:after:opacity-100">
      <LiveCode entry={entry} issuer={issuer} account={account} />
      <div className="flex items-center md:pr-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${name}`}>
              <EllipsisVerticalIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => onEdit(entry)}>
              <PencilIcon aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(entry)}>
              <Trash2Icon aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
});

const COPIED_MS = 1600;

function LiveCode({ entry, issuer, account }: { entry: VaultEntry; issuer: ReactNode; account: ReactNode }) {
  const now = useNow();
  const result = generateCode(entry, now);
  const announce = useAnnounce();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    const ok = await copyText(result.code);
    if (!ok) {
      toast.error("Could not copy the code. Read it from the screen instead.");
      return;
    }
    setCopied(true);
    markCopyHintDone();
    announce(`Copied ${entry.issuer} code`);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }

  const long = entry.digits > 6;
  return (
    <button
      type="button"
      onClick={() => void copy()}
      data-expiring={result.expiring || undefined}
      className={cn(
        "entry-grid min-h-[4.5rem] min-w-0 flex-1 cursor-pointer py-3 pr-1 pl-4 text-left outline-offset-[-3px] md:min-h-[4.75rem] md:pr-2 lg:pl-5",
      )}
    >
      <span className="sr-only">Copy code: </span>
      {issuer}
      {account}
      <span
        className={cn(
          "ga-code tnum leading-none font-bold whitespace-nowrap",
          long ? "code-8" : "code-6",
          result.expiring ? "text-primary" : "text-foreground",
        )}
      >
        <span aria-hidden="true">{result.formatted}</span>
        <span className="sr-only">{result.code.split("").join(" ")}</span>
      </span>
      <span className="ga-timer">
        <SweepClock elapsed={result.elapsed} expiring={result.expiring} className="ga-clock size-7 md:size-8" />
        {copied ? (
          <span className="ga-secs inline-flex items-center gap-1 text-sm font-semibold whitespace-nowrap text-foreground md:text-base">
            <CheckIcon aria-hidden="true" className="size-4" />
            Copied
          </span>
        ) : (
          // Visual only: the live seconds stay out of the button's accessible name.
          <span
            aria-hidden="true"
            className={cn(
              "ga-secs tnum text-sm whitespace-nowrap md:text-base",
              result.expiring ? "font-semibold text-signal" : "text-muted-foreground",
            )}
          >
            <span>{result.secondsLeft} s</span>
          </span>
        )}
      </span>
    </button>
  );
}
