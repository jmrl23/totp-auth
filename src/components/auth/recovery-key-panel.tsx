"use client";

import { useId, useState, type ReactNode } from "react";
import { CopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { buildRecoveryKeyFile, downloadTextFile, recoveryKeyFilename } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { copyText } from "@/hooks/use-copy";

/** The recovery key set in four groups, with Download .txt (primary) and Copy. */
export function RecoveryKeyPanel({ recoveryKey, username }: { recoveryKey: string; username: string }) {
  const groups = recoveryKey.split("-");

  async function copyKey() {
    const ok = await copyText(recoveryKey);
    if (ok) toast.success("Recovery key copied.");
    else toast.error("Could not copy. Select the key and copy it by hand, or download the file.");
  }

  function download() {
    downloadTextFile(
      recoveryKeyFilename(username),
      buildRecoveryKeyFile({ username, recoveryKey, origin: window.location.origin }),
    );
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Recovery key" className="rounded-md bg-card px-4 py-4">
        <p className="tnum flex flex-wrap gap-x-4 gap-y-1 font-mono text-xl font-bold tracking-[0.04em] select-all">
          {groups.map((group, i) => (
            <span key={i}>{group}</span>
          ))}
        </p>
      </div>
      <div className="flex flex-col gap-2 min-[22rem]:flex-row">
        <Button type="button" className="w-full min-[22rem]:w-auto min-[22rem]:flex-1" onClick={download}>
          <DownloadIcon aria-hidden="true" />
          Download .txt
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full min-[22rem]:w-auto min-[22rem]:flex-1"
          onClick={() => void copyKey()}
        >
          <CopyIcon aria-hidden="true" />
          Copy
        </Button>
      </div>
    </div>
  );
}

/**
 * A freshly issued recovery key with Download / Copy, a warning, and a required
 * "I saved my recovery key" checkbox before the continue action.
 */
export function SavedKeyGate({
  recoveryKey,
  username,
  warning,
  actionLabel,
  pendingLabel,
  onContinue,
}: {
  recoveryKey: string;
  username: string;
  warning: ReactNode;
  actionLabel: string;
  pendingLabel?: string;
  onContinue: () => void;
}) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-6">
      <RecoveryKeyPanel recoveryKey={recoveryKey} username={username} />
      {warning}
      <Field orientation="horizontal" className="min-h-11 items-center">
        <Checkbox id={id} checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
        <FieldLabel htmlFor={id} className="text-[0.9375rem] font-semibold">
          I saved my recovery key
        </FieldLabel>
      </Field>
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={!saved || pending}
        onClick={() => {
          if (pendingLabel) setPending(true);
          onContinue();
        }}
      >
        {pending && pendingLabel ? pendingLabel : actionLabel}
      </Button>
    </div>
  );
}
