"use client";

import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import {
  changePassword,
  downloadTextFile,
  exportEntries,
  parseImportText,
  regenerateRecoveryKey,
  useImportEntries,
  useSession,
  type ParsedImport,
} from "@/lib/client";
import { MAX_ENTRIES_PER_USER, passwordSchema, type VaultEntry } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ResponsiveModal } from "@/components/common/responsive-modal";
import { describeError, retryAfterOf } from "@/components/common/errors";
import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { RecoveryKeyPanel } from "@/components/auth/recovery-key-panel";
import { useCountdown } from "@/hooks/use-countdown";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

function ErrorLine({ id, message, wait }: { id?: string; message: string | null; wait?: number }) {
  return (
    <div id={id} aria-live="polite">
      {message ? (
        <p className="text-[0.9375rem] font-medium text-destructive">
          {message}
          {wait && wait > 0 ? ` Try again in ${wait} s.` : null}
        </p>
      ) : null}
    </div>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- Recovery key ---------- */

const recoveryPasswordSchema = z.object({ password: z.string().min(1, "Enter your password.") });

export function RecoveryKeyDialog({ open, onOpenChange, username }: DialogProps & { username: string }) {
  const session = useSession();
  const issued = session.data?.recoveryKeyCreatedAt;
  const id = useId();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wait = useCountdown();
  const form = useForm<z.input<typeof recoveryPasswordSchema>>({
    resolver: zodResolver(recoveryPasswordSchema),
    defaultValues: { password: "" },
  });
  const { isSubmitting, errors } = form.formState;

  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      setRecoveryKey(await regenerateRecoveryKey(password));
      void session.refetch();
    } catch (err) {
      const retry = retryAfterOf(err);
      if (retry) wait.start(retry);
      setError(describeError(err, "account"));
      form.setValue("password", "");
      form.setFocus("password");
    }
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Recovery key"
      description={
        recoveryKey
          ? "This replaces your earlier key. Save it now; it is not shown again."
          : issued
            ? `The current key was made on ${issued.slice(0, 10)}. It sets a new password if you forget yours, and erases your saved entries when used.`
            : "The key sets a new password if you forget yours, and erases your saved entries when used."
      }
    >
      {recoveryKey ? (
        <div className="space-y-4 pb-1">
          <RecoveryKeyPanel recoveryKey={recoveryKey} username={username} />
          <Alert>
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>The old key no longer works</AlertTitle>
            <AlertDescription>
              Replace any copy of the earlier key with this one. Anyone who has the key can take over the account.
            </AlertDescription>
          </Alert>
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            I saved my recovery key
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="pb-1">
          <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
          <FieldGroup className="gap-4">
            <p className="text-[0.9375rem]">
              Make a new key if you lost the file or think someone saw it. The old key stops working at once.
            </p>
            <Field data-invalid={!!errors.password || undefined}>
              <FieldLabel htmlFor={id}>Password</FieldLabel>
              <PasswordInput
                id={id}
                autoComplete="current-password"
                autoFocus
                aria-invalid={!!errors.password || undefined}
                aria-describedby={errors.password ? `${id}-e` : error ? `${id}-s` : undefined}
                {...form.register("password")}
              />
              <FieldError id={`${id}-e`} errors={[errors.password]} />
            </Field>
            <ErrorLine id={`${id}-s`} message={error} wait={wait.secondsLeft} />
            <Button type="submit" disabled={isSubmitting || wait.secondsLeft > 0}>
              {isSubmitting ? "Checking password..." : "Make a new recovery key"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </ResponsiveModal>
  );
}

/* ---------- Change password ---------- */

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "The new passwords do not match." })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from the current one.",
  });
type ChangeIn = z.input<typeof changeSchema>;

export function ChangePasswordDialog({
  open,
  onOpenChange,
  username,
  entryCount,
}: DialogProps & { username: string; entryCount: number }) {
  const ids = { cur: useId(), next: useId(), confirm: useId(), strength: useId() };
  const [error, setError] = useState<string | null>(null);
  const wait = useCountdown();
  const form = useForm<ChangeIn, unknown, z.output<typeof changeSchema>>({
    resolver: zodResolver(changeSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const newLength = (useWatch({ control: form.control, name: "newPassword" }) ?? "").length;

  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    try {
      await changePassword({ currentPassword, newPassword });
      toast.success("Password changed. Other devices were signed out.");
      onOpenChange(false);
    } catch (err) {
      const retry = retryAfterOf(err);
      if (retry) wait.start(retry);
      setError(describeError(err, "account"));
    }
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next);
      }}
      title="Change password"
      description="Every entry is re-encrypted with the new password in this browser, then saved in one step."
    >
      <form onSubmit={submit} noValidate className="pb-1">
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <FieldGroup className="gap-4">
          <Field data-invalid={!!errors.currentPassword || undefined}>
            <FieldLabel htmlFor={ids.cur}>Current password</FieldLabel>
            <PasswordInput
              id={ids.cur}
              autoComplete="current-password"
              autoFocus
              aria-invalid={!!errors.currentPassword || undefined}
              aria-describedby={errors.currentPassword ? `${ids.cur}-e` : undefined}
              {...form.register("currentPassword")}
            />
            <FieldError id={`${ids.cur}-e`} errors={[errors.currentPassword]} />
          </Field>
          <Field data-invalid={!!errors.newPassword || undefined}>
            <FieldLabel htmlFor={ids.next}>New password</FieldLabel>
            <PasswordInput
              id={ids.next}
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword || undefined}
              aria-describedby={`${ids.strength}${errors.newPassword ? ` ${ids.next}-e` : ""}`}
              {...form.register("newPassword")}
            />
            <PasswordStrength length={newLength} id={ids.strength} />
            <FieldError id={`${ids.next}-e`} errors={[errors.newPassword]} />
          </Field>
          <Field data-invalid={!!errors.confirm || undefined}>
            <FieldLabel htmlFor={ids.confirm}>Repeat new password</FieldLabel>
            <PasswordInput
              id={ids.confirm}
              autoComplete="new-password"
              aria-invalid={!!errors.confirm || undefined}
              aria-describedby={errors.confirm ? `${ids.confirm}-e` : undefined}
              {...form.register("confirm")}
            />
            <FieldError id={`${ids.confirm}-e`} errors={[errors.confirm]} />
          </Field>
          <p className="text-sm text-muted-foreground">
            The new password cannot be read back either. Your recovery key stays valid.
          </p>
          <ErrorLine message={error} wait={wait.secondsLeft} />
          <p aria-live="polite" className="text-sm font-medium">
            {isSubmitting ? `Re-encrypting ${plural(entryCount, "entry", "entries")}. Keep this page open...` : ""}
          </p>
          <Button type="submit" disabled={isSubmitting || wait.secondsLeft > 0}>
            {isSubmitting ? "Changing password..." : "Change password"}
          </Button>
        </FieldGroup>
      </form>
    </ResponsiveModal>
  );
}

/* ---------- Export ---------- */

export function ExportDialog({ open, onOpenChange, entries }: DialogProps & { entries: VaultEntry[] }) {
  function download() {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`totp-auth-export-${date}.txt`, exportEntries(entries));
    toast.success(`Exported ${plural(entries.length, "entry", "entries")}.`);
    onOpenChange(false);
  }
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Export entries"
      description="A plain text file with one otpauth:// link per line. Any authenticator app can import it."
    >
      <div className="space-y-4 pb-1">
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>The file is not encrypted</AlertTitle>
          <AlertDescription>
            It contains every secret in readable form. Anyone with the file can generate your codes. Store it somewhere
            safe and delete it when you no longer need it.
          </AlertDescription>
        </Alert>
        {entries.length === 0 ? (
          <p className="text-[0.9375rem] text-muted-foreground">The vault is empty, so there is nothing to export.</p>
        ) : null}
        <Button className="w-full" disabled={entries.length === 0} onClick={download}>
          Download {plural(entries.length, "entry", "entries")}
        </Button>
      </div>
    </ResponsiveModal>
  );
}

/* ---------- Import ---------- */

export function ImportDialog({ open, onOpenChange, entries }: DialogProps & { entries: VaultEntry[] }) {
  const ids = { file: useId(), text: useId() };
  const importer = useImportEntries();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 1_000_000) {
      setError("That file is larger than 1 MB. An export with 500 entries is far smaller; check that it is the right file.");
      return;
    }
    setText(await file.text());
    setParsed(null);
  }

  function check() {
    setError(null);
    if (!text.trim()) {
      setError("Choose a file or paste otpauth:// links first.");
      return;
    }
    setParsed(parseImportText(text, entries));
  }

  const count = parsed?.entries.length ?? 0;
  const overLimit = entries.length + count > MAX_ENTRIES_PER_USER;

  async function confirm() {
    if (!parsed || count === 0) return;
    setPending(true);
    setError(null);
    try {
      await importer.mutateAsync(parsed.entries);
      toast.success(`Imported ${plural(count, "entry", "entries")}.`);
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, "import"));
    } finally {
      setPending(false);
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title="Import entries"
      description="Use a file or text with one otpauth:// link per line, such as an export from this app."
      wide
    >
      <div className="space-y-4 pb-1">
        {parsed ? (
          <>
            <dl className="tnum grid grid-cols-3 gap-px overflow-hidden rounded-md bg-border text-center">
              <div className="bg-card px-2 py-3">
                <dt className="text-sm text-muted-foreground">New</dt>
                <dd className="text-2xl font-bold">{count}</dd>
              </div>
              <div className="bg-card px-2 py-3">
                <dt className="text-sm text-muted-foreground">Already in vault</dt>
                <dd className="text-2xl font-bold">{parsed.duplicates}</dd>
              </div>
              <div className="bg-card px-2 py-3">
                <dt className="text-sm text-muted-foreground">Not usable</dt>
                <dd className="text-2xl font-bold">{parsed.errors.length}</dd>
              </div>
            </dl>
            {parsed.errors.length > 0 ? (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Lines that will be skipped</h3>
                <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
                  {parsed.errors.map((e) => (
                    <li key={`${e.line}-${e.message}`} className="flex gap-3 border-b px-3 py-2 last:border-b-0">
                      <span className="tnum w-16 shrink-0 text-muted-foreground">Line {e.line}</span>
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {overLimit ? (
              <p className="text-[0.9375rem] font-medium text-destructive">
                This would take the vault past {MAX_ENTRIES_PER_USER} entries. It has room for{" "}
                {Math.max(0, MAX_ENTRIES_PER_USER - entries.length)} more.
              </p>
            ) : count === 0 ? (
              <p className="text-[0.9375rem] text-muted-foreground">There is nothing new to import.</p>
            ) : null}
            <ErrorLine message={error} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setParsed(null)} disabled={pending}>
                Back
              </Button>
              <Button onClick={() => void confirm()} disabled={pending || count === 0 || overLimit}>
                {pending ? `Encrypting and saving ${plural(count, "entry", "entries")}...` : `Import ${plural(count, "entry", "entries")}`}
              </Button>
            </div>
          </>
        ) : (
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={ids.file}>File</FieldLabel>
              <Input
                id={ids.file}
                type="file"
                accept=".txt,text/plain,.csv"
                className="h-auto py-2.5 file:mr-3 file:h-8 file:rounded-sm file:bg-secondary file:px-3"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.text}>Or paste the links</FieldLabel>
              <Textarea
                id={ids.text}
                rows={6}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setParsed(null);
                }}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="otpauth://totp/GitHub:you?secret=..."
                className="max-h-64 min-h-32 font-mono text-sm break-all"
                aria-describedby={`${ids.text}-d`}
              />
              <FieldDescription id={`${ids.text}-d`}>Nothing is saved until you confirm on the next step.</FieldDescription>
            </Field>
            <ErrorLine message={error} />
            <Button onClick={check}>Check entries</Button>
          </FieldGroup>
        )}
      </div>
    </ResponsiveModal>
  );
}
