"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { AUTO_LOCK_DEFAULTS, lock, logout, useAutoLock, useClockDrift, useLockState, useVault } from "@/lib/client";
import { MAX_ENTRIES_PER_USER, type VaultEntry } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AnnouncerProvider } from "@/hooks/use-announcer";
import { TopBar, type AccountAction } from "@/components/vault/top-bar";
import { EntryList } from "@/components/vault/entry-list";
import { EntryEditor, type EditorTarget } from "@/components/vault/entry-editor";
import { DeleteEntryDialog } from "@/components/vault/delete-entry-dialog";
import { SkeletonRows, VaultSkeleton } from "@/components/vault/vault-skeleton";
import { UnlockScreen } from "@/components/vault/unlock-screen";
import {
  ChangePasswordDialog,
  ExportDialog,
  ImportDialog,
  RecoveryKeyDialog,
} from "@/components/vault/account-dialogs";

/** Client shell: routes the lock state to the right screen. The page has already checked the session. */
export function VaultApp({ username }: { username: string }) {
  const state = useLockState();
  const router = useRouter();
  // Why the vault last locked. Derived from the unlocked -> locked transition: a lock the person
  // asked for (menu) clears the reason; any other lock while open was the inactivity timer.
  const [prevState, setPrevState] = useState(state);
  const [manualLock, setManualLock] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  if (state !== prevState) {
    setPrevState(state);
    if (prevState === "unlocked" && state === "locked") {
      setLockNotice(manualLock ? null : "Locked after a period of inactivity.");
      setManualLock(false);
    } else if (state === "unlocked") {
      setLockNotice(null);
    }
  }

  useEffect(() => {
    if (state === "signed-out") router.replace("/login");
  }, [state, router]);

  if (state === "locked") return <UnlockScreen username={username} notice={lockNotice} />;
  if (state === "unlocked") {
    return (
      <AnnouncerProvider>
        <VaultView username={username} onManualLock={() => setManualLock(true)} />
      </AnnouncerProvider>
    );
  }
  return <VaultSkeleton />;
}

type AccountDialog = Exclude<AccountAction, "lock" | "signout">;

function matches(entry: VaultEntry, q: string) {
  return entry.issuer.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q);
}

function VaultView({ username, onManualLock }: { username: string; onManualLock: () => void }) {
  const router = useRouter();
  useAutoLock(AUTO_LOCK_DEFAULTS);
  const vault = useVault();
  const entries = vault.entries;
  const undecryptable = vault.undecryptable;
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ key: number; target: EditorTarget; open: boolean }>({
    key: 0,
    target: { mode: "add" },
    open: false,
  });
  const [deleting, setDeleting] = useState<{ entry: VaultEntry | null; open: boolean }>({ entry: null, open: false });
  const [dialog, setDialog] = useState<AccountDialog | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => (q ? entries.filter((e) => matches(e, q)) : entries), [entries, q]);
  const atLimit = entries.length >= MAX_ENTRIES_PER_USER;

  const openAdd = useCallback(() => {
    setEditor((s) => ({ key: s.key + 1, target: { mode: "add" }, open: true }));
  }, []);
  const onEdit = useCallback((entry: VaultEntry) => {
    setEditor((s) => ({ key: s.key + 1, target: { mode: "edit", entry }, open: true }));
  }, []);
  const onDelete = useCallback((entry: VaultEntry) => setDeleting({ entry, open: true }), []);

  async function onAccount(action: AccountAction) {
    if (action === "lock") {
      onManualLock();
      await lock();
      return;
    }
    if (action === "signout") {
      try {
        await logout();
      } catch {
        toast.error("The server did not confirm sign-out. This browser's key was removed anyway.");
      }
      router.replace("/login");
      router.refresh();
      return;
    }
    setDialogKey((k) => k + 1);
    setDialog(action);
  }

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        username={username}
        query={query}
        onQueryChange={setQuery}
        onAdd={openAdd}
        addDisabled={atLimit}
        onAccount={(a) => void onAccount(a)}
      />
      <main className="pad-safe-bottom mx-auto w-full max-w-7xl flex-1 md:px-6 lg:px-12">
        <h1 className="sr-only">Your codes</h1>
        <Notices
          undecryptable={undecryptable}
          atLimit={atLimit}
          loadError={vault.error ? "The vault could not be loaded from the server." : null}
          onRetry={vault.refetch}
        />
        <div className="pt-1 md:pt-3">
          {vault.isLoading ? (
            <SkeletonRows />
          ) : entries.length === 0 && !vault.error ? (
            <EmptyVault onAdd={openAdd} hasUndecryptable={undecryptable > 0} />
          ) : visible.length === 0 && q ? (
            <NoMatch query={query.trim()} onClear={() => setQuery("")} />
          ) : (
            <EntryList entries={visible} onEdit={onEdit} onDelete={onDelete} />
          )}
        </div>
        <p aria-live="polite" className="sr-only">
          {q ? `${visible.length} of ${entries.length} entries shown` : ""}
        </p>
      </main>

      <EntryEditor
        key={editor.key}
        target={editor.target}
        open={editor.open}
        onOpenChange={(open) => setEditor((s) => ({ ...s, open }))}
      />
      <DeleteEntryDialog
        entry={deleting.entry}
        open={deleting.open}
        onOpenChange={(open) => setDeleting((s) => ({ ...s, open }))}
      />
      <RecoveryKeyDialog
        key={`r${dialogKey}`}
        open={dialog === "recovery"}
        onOpenChange={closeDialog}
        username={username}
      />
      <ChangePasswordDialog
        key={`p${dialogKey}`}
        open={dialog === "password"}
        onOpenChange={closeDialog}
        username={username}
        entryCount={entries.length}
      />
      <ExportDialog key={`e${dialogKey}`} open={dialog === "export"} onOpenChange={closeDialog} entries={entries} />
      <ImportDialog key={`i${dialogKey}`} open={dialog === "import"} onOpenChange={closeDialog} entries={entries} />
    </div>
  );
}

function Notices({
  undecryptable,
  atLimit,
  loadError,
  onRetry,
}: {
  undecryptable: number;
  atLimit: boolean;
  loadError: string | null;
  onRetry: () => void;
}) {
  const drift = useClockDrift().driftMs;
  const driftSeconds = drift === null ? 0 : Math.round(Math.abs(drift) / 1000);
  const showDrift = drift !== null && Math.abs(drift) > 2000;
  if (!showDrift && !undecryptable && !atLimit && !loadError) return null;
  return (
    <div className="pad-safe-x flex flex-col gap-2 pt-3 md:px-0">
      {loadError ? (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{loadError}</AlertTitle>
          <AlertDescription>
            Check your connection, then try again.
            <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {showDrift ? (
        <p role="status" className="rounded-sm border border-foreground px-4 py-2.5 text-[0.9375rem]">
          This device&apos;s clock is {driftSeconds} seconds {drift > 0 ? "behind" : "ahead of"} the server. Codes
          follow the server clock, so they are still correct.
        </p>
      ) : null}
      {undecryptable > 0 ? (
        <p role="status" className="rounded-sm bg-secondary px-4 py-2.5 text-[0.9375rem]">
          {undecryptable === 1
            ? "1 entry could not be decrypted with this password and is hidden. It is left unchanged on the server."
            : `${undecryptable} entries could not be decrypted with this password and are hidden. They are left unchanged on the server.`}
        </p>
      ) : null}
      {atLimit ? (
        <p role="status" className="rounded-sm bg-secondary px-4 py-2.5 text-[0.9375rem]">
          This vault holds the maximum of {MAX_ENTRIES_PER_USER} entries. Delete one to add another.
        </p>
      ) : null}
    </div>
  );
}

function EmptyVault({ onAdd, hasUndecryptable }: { onAdd: () => void; hasUndecryptable: boolean }) {
  return (
    <div className="pad-safe-x py-14 md:px-0 md:py-20">
      <div className="max-w-md">
        <h2 className="text-[1.5rem] leading-tight font-bold tracking-[-0.01em]">
          {hasUndecryptable ? "No readable entries" : "No entries yet"}
        </h2>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground text-pretty">
          Scan the QR code a service shows when you turn on two-factor sign-in, or paste its setup link.
        </p>
        <Button size="lg" className="mt-6" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          Add your first entry
        </Button>
      </div>
    </div>
  );
}

function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="pad-safe-x py-14 md:px-0">
      <h2 className="text-[1.25rem] font-bold">No entries match &ldquo;{query}&rdquo;</h2>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">Search looks at service and account names.</p>
      <Button variant="outline" className="mt-5" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}
