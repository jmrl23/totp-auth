"use client";

import { useEffect, useRef } from "react";
import {
  CircleUserRoundIcon,
  DownloadIcon,
  KeyRoundIcon,
  LockIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { AUTO_LOCK_DEFAULTS } from "@/lib/client";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type AccountAction = "recovery" | "password" | "export" | "import" | "lock" | "signout";

type Props = {
  username: string;
  query: string;
  onQueryChange: (q: string) => void;
  onAdd: () => void;
  addDisabled: boolean;
  onAccount: (action: AccountAction) => void;
};

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function TopBar({ username, query, onQueryChange, onAdd, addDisabled, onAccount }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search (desktop keyboards), Escape in the field clears it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="surface-bar pad-safe-top sticky top-0 z-30">
      <div className="pad-safe-x mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 pt-2 pb-3 md:h-16 md:flex-nowrap md:gap-6 md:px-6 md:py-0 lg:px-12">
        <Wordmark className="mr-auto shrink-0 md:mr-0 md:w-52" />
        <search className="relative order-last min-w-0 basis-full md:order-none md:basis-auto md:flex-1">
          <label htmlFor="vault-search" className="sr-only">
            Search entries by service or account
          </label>
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-bar-muted"
          />
          <input
            ref={searchRef}
            id="vault-search"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                onQueryChange("");
              }
            }}
            placeholder="Search issuer or account"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            className="h-11 w-full min-w-0 rounded-sm bg-bar-field pr-10 pl-9 text-base text-bar-foreground outline-none placeholder:text-bar-muted focus-visible:ring-2 focus-visible:ring-bar-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute top-0 right-0 inline-flex size-11 items-center justify-center rounded-sm text-bar-muted hover:text-bar-foreground"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-[3px] border border-bar-muted/50 px-1.5 text-xs leading-5 text-bar-muted md:inline"
            >
              /
            </kbd>
          )}
        </search>
        <Button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="size-11 shrink-0 px-0 md:w-auto md:px-5"
          aria-label="Add entry"
        >
          <PlusIcon aria-hidden="true" className="size-5 md:size-4" />
          <span className="hidden md:inline">Add entry</span>
        </Button>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Account menu for ${username}`}
                  className="shrink-0 text-bar-foreground hover:bg-bar-field hover:text-bar-foreground aria-expanded:bg-bar-field aria-expanded:text-bar-foreground"
                >
                  <CircleUserRoundIcon aria-hidden="true" className="size-5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{username}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate">Signed in as {username}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAccount("recovery")}>
              <ShieldCheckIcon aria-hidden="true" />
              Recovery key
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAccount("password")}>
              <KeyRoundIcon aria-hidden="true" />
              Change password
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAccount("export")}>
              <DownloadIcon aria-hidden="true" />
              Export
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAccount("import")}>
              <UploadIcon aria-hidden="true" />
              Import
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAccount("lock")} className="items-start" aria-describedby="lock-hint">
              <LockIcon aria-hidden="true" className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span>Lock</span>
                <span id="lock-hint" className="text-xs leading-snug text-muted-foreground">
                  Also locks by itself after {AUTO_LOCK_DEFAULTS.idleMinutes} min idle or{" "}
                  {AUTO_LOCK_DEFAULTS.hiddenMinutes} min in the background.
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAccount("signout")}>
              <LogOutIcon aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
