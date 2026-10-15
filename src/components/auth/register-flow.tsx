"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api, register } from "@/lib/client";
import { passwordSchema, usernameSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AuthHeading } from "@/components/auth/auth-frame";
import { PasswordInput } from "@/components/auth/password-input";
import { PasswordStrength } from "@/components/auth/password-strength";
import { SavedKeyGate } from "@/components/auth/recovery-key-panel";
import { describeError, retryAfterOf } from "@/components/common/errors";
import { useCountdown } from "@/hooks/use-countdown";

type Step = { kind: "account" } | { kind: "key"; username: string; recoveryKey: string };

export function RegisterFlow() {
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api.getAuthConfig(), staleTime: 60_000 });
  const [step, setStep] = useState<Step>({ kind: "account" });

  if (step.kind === "key") return <KeyStep username={step.username} recoveryKey={step.recoveryKey} />;

  if (config.isPending) {
    return (
      <div aria-busy="true" aria-label="Checking whether registration is open" className="space-y-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (config.isError) {
    return (
      <div>
        <AuthHeading title="Could not reach the server" lead="Registration status could not be checked. Check your connection and try again." />
        <Button size="lg" className="w-full" onClick={() => void config.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!config.data.registrationOpen) {
    if (config.data.closedReason === "setup_token_missing") {
      return (
        <div>
          <AuthHeading
            title="This instance needs a setup token first"
            lead={
              <>
                Before the first account can be created, the server must have a{" "}
                <code className="rounded-sm bg-secondary px-1 py-0.5 font-mono text-[0.875em] text-foreground">
                  SETUP_TOKEN
                </code>{" "}
                environment variable. Set it to a long random value on the server, restart totp-auth, then come back
                here and enter the same value.
              </>
            }
          />
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      );
    }
    return (
      <div>
        <AuthHeading
          title="Registration is closed on this instance"
          lead="This instance already has its account. If it is yours, sign in. To allow another account, the person who runs the server can set ALLOW_REGISTRATION=true."
        />
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <AccountStep
      setupTokenRequired={config.data.setupTokenRequired}
      onDone={(username, recoveryKey) => setStep({ kind: "key", username, recoveryKey })}
    />
  );
}

/* ---------- step 1: account ---------- */

function makeAccountSchema(setupTokenRequired: boolean) {
  return z
    .object({
      username: usernameSchema,
      password: passwordSchema,
      confirm: z.string(),
      setupToken: z.string().trim().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.password !== v.confirm) {
        ctx.addIssue({ code: "custom", path: ["confirm"], message: "The passwords do not match." });
      }
      if (setupTokenRequired && !v.setupToken) {
        ctx.addIssue({ code: "custom", path: ["setupToken"], message: "Enter the setup token." });
      }
    });
}

function AccountStep({
  setupTokenRequired,
  onDone,
}: {
  setupTokenRequired: boolean;
  onDone: (username: string, recoveryKey: string) => void;
}) {
  const ids = { username: useId(), password: useId(), confirm: useId(), token: useId(), strength: useId(), note: useId() };
  const [schema] = useState(() => makeAccountSchema(setupTokenRequired));
  const [error, setError] = useState<string | null>(null);
  const wait = useCountdown();
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "", confirm: "", setupToken: "" },
  });
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const { errors, isSubmitting } = form.formState;
  const blocked = wait.secondsLeft > 0;

  const onSubmit = form.handleSubmit(async ({ username, password, setupToken }) => {
    setError(null);
    try {
      const recoveryKey = await register({
        username,
        password,
        ...(setupTokenRequired && setupToken ? { setupToken } : {}),
      });
      onDone(username, recoveryKey);
    } catch (err) {
      const retry = retryAfterOf(err);
      if (retry) wait.start(retry);
      setError(describeError(err, "register"));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <AuthHeading title="Create your account" lead="Step 1 of 2. One account per instance. It holds every code you add." />
      <FieldGroup>
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
            aria-describedby={`${ids.username}-d${errors.username ? ` ${ids.username}-e` : ""}`}
            {...form.register("username")}
          />
          <FieldDescription id={`${ids.username}-d`}>3 to 32 lowercase letters, digits, dots, dashes or underscores.</FieldDescription>
          <FieldError id={`${ids.username}-e`} errors={[errors.username]} />
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor={ids.password}>Password</FieldLabel>
          <PasswordInput
            id={ids.password}
            autoComplete="new-password"
            aria-invalid={!!errors.password || undefined}
            aria-describedby={`${ids.strength} ${ids.note}${errors.password ? ` ${ids.password}-e` : ""}`}
            {...form.register("password")}
          />
          <PasswordStrength length={password.length} id={ids.strength} />
          <FieldError id={`${ids.password}-e`} errors={[errors.password]} />
        </Field>
        <Field data-invalid={!!errors.confirm || undefined}>
          <FieldLabel htmlFor={ids.confirm}>Repeat password</FieldLabel>
          <PasswordInput
            id={ids.confirm}
            autoComplete="new-password"
            aria-invalid={!!errors.confirm || undefined}
            aria-describedby={errors.confirm ? `${ids.confirm}-e` : undefined}
            {...form.register("confirm")}
          />
          <FieldError id={`${ids.confirm}-e`} errors={[errors.confirm]} />
        </Field>
        {setupTokenRequired ? (
          <Field data-invalid={!!errors.setupToken || undefined}>
            <FieldLabel htmlFor={ids.token}>
              Setup token <span className="font-normal text-muted-foreground">(required)</span>
            </FieldLabel>
            <Input
              id={ids.token}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-required="true"
              aria-invalid={!!errors.setupToken || undefined}
              aria-describedby={`${ids.token}-d${errors.setupToken ? ` ${ids.token}-e` : ""}`}
              {...form.register("setupToken")}
            />
            <FieldDescription id={`${ids.token}-d`}>
              The value of the SETUP_TOKEN environment variable on this server. It proves you run this instance.
            </FieldDescription>
            <FieldError id={`${ids.token}-e`} errors={[errors.setupToken]} />
          </Field>
        ) : null}
        <Alert id={ids.note}>
          <AlertTitle>Your password cannot be read back</AlertTitle>
          <AlertDescription>
            The password encrypts your vault in this browser. The server only stores the encrypted result, so nobody,
            including whoever runs this server, can recover it. Keep it in a password manager. The next step gives you
            a recovery key for the account.
          </AlertDescription>
        </Alert>
        <div aria-live="polite">
          {error ? (
            <p className="text-[0.9375rem] font-medium text-destructive">
              {error}
              {blocked ? ` Try again in ${wait.secondsLeft} s.` : null}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || blocked}>
          {isSubmitting ? "Creating your encryption key..." : "Continue"}
        </Button>
        <p className="text-[0.9375rem] text-muted-foreground">
          Already set up?{" "}
          <Link href="/login" className="font-semibold text-foreground underline">
            Sign in
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}

/* ---------- step 2: recovery key ---------- */

function KeyStep({ username, recoveryKey }: { username: string; recoveryKey: string }) {
  const router = useRouter();
  return (
    <div>
      <AuthHeading
        title="Save your recovery key"
        lead="Step 2 of 2. Your account is created. If you forget your password, this key lets you set a new one. It is shown only now."
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
            <AlertTitle>The key restores the account, not your entries</AlertTitle>
            <AlertDescription>
              Entries are encrypted with your password and nobody else can read them. If you use the key after
              forgetting the password, you get access back with an empty vault: all saved entries are erased. Keep the
              file private, because anyone who has it can take over the account.
            </AlertDescription>
          </Alert>
        }
      />
    </div>
  );
}
