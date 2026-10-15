"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAddEntry, useUpdateEntry } from "@/lib/client";
import type { EntryPlain, VaultEntry } from "@/lib/schemas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveModal } from "@/components/common/responsive-modal";
import { describeError } from "@/components/common/errors";
import { useIsDesktop } from "@/hooks/use-media-query";
import { EMPTY_ENTRY, EntryForm } from "@/components/vault/entry-form";
import { PastePanel } from "@/components/vault/paste-panel";
import { ScanPanel } from "@/components/vault/scan-panel";

export type EditorTarget = { mode: "add" } | { mode: "edit"; entry: VaultEntry };

type Props = {
  target: EditorTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function displayName(e: Pick<EntryPlain, "issuer" | "label">) {
  return e.label ? `${e.issuer} (${e.label})` : e.issuer;
}

/** Add or edit an entry. Mount with a fresh `key` per opening so state starts clean. */
export function EntryEditor({ target, open, onOpenChange }: Props) {
  if (target.mode === "edit") {
    return (
      <ResponsiveModal
        open={open}
        onOpenChange={onOpenChange}
        title={`Edit ${target.entry.issuer}`}
        description="Changes are encrypted in this browser before they are saved."
      >
        <EditBody entry={target.entry} onClose={() => onOpenChange(false)} />
      </ResponsiveModal>
    );
  }
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add entry"
      description="Scan the service's QR code, paste its setup link, or type the secret."
      wide
    >
      <AddBody onClose={() => onOpenChange(false)} />
    </ResponsiveModal>
  );
}

function EditBody({ entry, onClose }: { entry: VaultEntry; onClose: () => void }) {
  const update = useUpdateEntry();
  const { id } = entry;
  const plain: EntryPlain = {
    issuer: entry.issuer,
    label: entry.label,
    secret: entry.secret,
    algorithm: entry.algorithm,
    digits: entry.digits,
    period: entry.period,
  };
  return (
    <EntryForm
      mode="edit"
      defaults={plain}
      hideSecret
      submitLabel="Save changes"
      pendingLabel="Saving..."
      onBack={onClose}
      backLabel="Cancel"
      onSubmit={async (next) => {
        try {
          await update.mutateAsync({ id, plain: next });
          toast.success(`Saved ${displayName(next)}.`);
          onClose();
          return null;
        } catch (err) {
          return describeError(err, "vault");
        }
      }}
    />
  );
}

function AddBody({ onClose }: { onClose: () => void }) {
  const isDesktop = useIsDesktop();
  const add = useAddEntry();
  const [tab, setTab] = useState<string>(() => (isDesktop ? "paste" : "scan"));
  const [draft, setDraft] = useState<EntryPlain | null>(null);

  async function save(plain: EntryPlain): Promise<string | null> {
    try {
      await add.mutateAsync(plain);
      toast.success(`Added ${displayName(plain)}.`);
      onClose();
      return null;
    } catch (err) {
      return describeError(err, "vault");
    }
  }

  if (draft) {
    return (
      <div className="space-y-4">
        <p className="text-[0.9375rem] text-muted-foreground">Check the details, then add the entry.</p>
        <EntryForm
          mode="add"
          defaults={draft}
          autoFocusIssuer={!draft.issuer}
          submitLabel="Add entry"
          pendingLabel="Adding..."
          onBack={() => setDraft(null)}
          onSubmit={save}
        />
      </div>
    );
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="scan">Scan</TabsTrigger>
        <TabsTrigger value="paste">Paste link</TabsTrigger>
        <TabsTrigger value="manual">Enter manually</TabsTrigger>
      </TabsList>
      <TabsContent value="scan">
        <ScanPanel onParsed={setDraft} />
      </TabsContent>
      <TabsContent value="paste">
        <PastePanel onParsed={setDraft} />
      </TabsContent>
      <TabsContent value="manual">
        <EntryForm mode="add" defaults={EMPTY_ENTRY} submitLabel="Add entry" pendingLabel="Adding..." onSubmit={save} />
      </TabsContent>
    </Tabs>
  );
}
