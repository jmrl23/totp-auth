"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { recoverAccount } from "@/lib/client";
import { passwordSchema, recoveryKeySchema, usernameSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AuthHeading } from "@/components/auth/auth-frame";
import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { SavedKeyGate } from "@/components/auth/recovery-key-panel";
import { describeError, retryAfterOf } from "@/components/common/errors";
import { useCountdown } from "@/hooks/use-countdown";

type Step = { kind: "form" } | { kind: "key"; username: string; recoveryKey: string };

export function RecoverFlow() {
  const [step, setStep] = useState<Step>({ kind: "form" });
  if (step.kind === "key") return <KeyStep username={step.username} recoveryKey={step.recoveryKey} />;
  return <RecoverForm onDone={(username, recoveryKey) => setStep({ kind: "key", username, recoveryKey })} />;
}

const recoverSchema = z
  .object({
    username: usernameSchema,
    recoveryKey: recoveryKeySchema,
    password: passwordSchema,
    confirm: z.string(),
    erase: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "The passwords do not match." });
    }
    if (!v.erase) {
      ctx.addIssue({ code: "custom", path: ["erase"], message: "Confirm that your saved entries will be erased." });
    }
  });

function RecoverForm({ onDone }: { onDone: (username: string, recoveryKey: string) => void }) {
  const ids = {
    username: useId(),
    key: useId(),
    password: useId(),
    confirm: useId(),
    erase: useId(),
    strength: useId(),
    warning: useId(),
  };
  const [error, setError] = useState<string | null>(null);
  const wait = useCountdown();
  const form = useForm<z.input<typeof recoverSchema>, unknown, z.output<typeof recoverSchema>>({
    resolver: zodResolver(recoverSchema),
    defaultValues: { username: "", recoveryKey: "", password: "", confirm: "", erase: false },
  });
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const { errors, isSubmitting } = form.formState;
  const blocked = wait.secondsLeft > 0;

  const onSubmit = form.handleSubmit(async ({ username, recoveryKey, password }) => {
    setError(null);
    try {
      onDone(username, await recoverAccount({ username, recoveryKey, newPassword: password }));
    } catch (err) {
      const retry = retryAfterOf(err);
      if (retry) wait.start(retry);
      setError(describeError(err, "recover"));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <AuthHeading
        title="Forgot your password?"
        lead="Enter the recovery key you downloaded when you created the account, then choose a new password."
      />
      <FieldGroup>
        <Alert id={ids.warning}>
          <AlertTitle>Your saved entries will be erased</AlertTitle>
          <AlertDescription>
            Entries are encrypted with your old password, which the server never had, so they cannot be opened without
            it. Recovery gives you the account back with an empty vault. If you remember the password, sign in instead.
          </AlertDescription>
        </Alert>
        <Field data-invalid={!!errors.username || undefined}>
          <FieldLabel htmlFor={ids.username}>Username</FieldLabel>
          <Input
            id={ids.username}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-invalid={!!errors.username || undefined}
            aria-describedby={errors.username ? `${ids.username}-e` : undefined}
            {...form.register("username")}
          />
          <FieldError id={`${ids.username}-e`} errors={[errors.username]} />
        </Field>
        <Field data-invalid={!!errors.recoveryKey || undefined}>
          <FieldLabel htmlFor={ids.key}>Recovery key</FieldLabel>
          <Input
            id={ids.key}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            className="tnum font-mono text-base tracking-[0.04em] uppercase"
            aria-invalid={!!errors.recoveryKey || undefined}
            aria-describedby={`${ids.key}-d${errors.recoveryKey ? ` ${ids.key}-e` : ""}`}
            {...form.register("recoveryKey")}
          />
          <FieldDescription id={`${ids.key}-d`}>20 characters from the .txt file. Dashes and capitals do not matter.</FieldDescription>
          <FieldError id={`${ids.key}-e`} errors={[errors.recoveryKey]} />
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor={ids.password}>New password</FieldLabel>
          <PasswordInput
            id={ids.password}
            autoComplete="new-password"
            aria-invalid={!!errors.password || undefined}
            aria-describedby={`${ids.strength}${errors.password ? ` ${ids.password}-e` : ""}`}
            {...form.register("password")}
          />
          <PasswordStrength length={password.length} id={ids.strength} />
          <FieldError id={`${ids.password}-e`} errors={[errors.password]} />
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
        <Field data-invalid={!!errors.erase || undefined}>
          <div className="flex min-h-11 items-center gap-3">
            <Controller
              control={form.control}
              name="erase"
              render={({ field }) => (
                <Checkbox
                  id={ids.erase}
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                  aria-invalid={!!errors.erase || undefined}
                  aria-describedby={errors.erase ? `${ids.erase}-e` : undefined}
                />
              )}
            />
            <FieldLabel htmlFor={ids.erase} className="text-[0.9375rem] font-semibold">
              I understand my saved entries will be erased
            </FieldLabel>
          </div>
          <FieldError id={`${ids.erase}-e`} errors={[errors.erase]} />
        </Field>
        <div aria-live="polite">
          {error ? (
            <p className="text-[0.9375rem] font-medium text-destructive">
              {error}
              {blocked ? ` Try again in ${wait.secondsLeft} s.` : null}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || blocked}>
          {isSubmitting ? "Creating your encryption key..." : blocked ? `Wait ${wait.secondsLeft} s` : "Set new password"}
        </Button>
        <p className="text-[0.9375rem] text-muted-foreground">
          <Link href="/login" className="font-semibold text-foreground underline">
            Back to sign in
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}

function KeyStep({ username, recoveryKey }: { username: string; recoveryKey: string }) {
  const router = useRouter();
  return (
    <div>
      <AuthHeading
        title="Save your new recovery key"
        lead="Your password is changed and you are signed in. The old recovery key no longer works. This new one is shown only now."
      />
      <SavedKeyGate
        recoveryKey={recoveryKey}
        username={username}
        actionLabel="Open my vault"
        pendingLabel="Opening your vault..."
        onContinue={() => {
          router.replace("/vault");
          router.refresh();
        }}
        warning={
          <Alert>
            <AlertTitle>Your vault is empty</AlertTitle>
            <AlertDescription>
              The earlier entries were erased and cannot be brought back. Add your codes again, or import an export file
              if you saved one.
            </AlertDescription>
          </Alert>
        }
      />
    </div>
  );
}
