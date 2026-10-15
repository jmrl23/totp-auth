"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useDeleteEntry } from "@/lib/client";
import type { VaultEntry } from "@/lib/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeError } from "@/components/common/errors";

export function DeleteEntryDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: VaultEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeleteEntry();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = entry ? (entry.label ? `${entry.issuer} (${entry.label})` : entry.issuer) : "";

  async function confirm() {
    if (!entry) return;
    setPending(true);
    setError(null);
    try {
      await remove.mutateAsync(entry.id);
      toast.success(`Deleted ${name}.`);
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, "vault"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setError(null);
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The entry and its secret are removed from your vault. This cannot be undone from this app. Make sure you
            can still sign in to {entry?.issuer ?? "the service"} another way first, or turn off two-factor sign-in
            there.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div aria-live="polite">
          {error ? <p className="text-[0.9375rem] font-medium text-destructive">{error}</p> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep entry</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {pending ? "Deleting..." : "Delete entry"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
