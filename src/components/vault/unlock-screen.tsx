"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { logout, unlock } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AuthFrame, AuthHeading } from "@/components/auth/auth-frame";
import { PasswordInput } from "@/components/auth/password-input";
import { describeError, retryAfterOf } from "@/components/common/errors";
import { useCountdown } from "@/hooks/use-countdown";

const unlockSchema = z.object({ password: z.string().min(1, "Enter your password.") });

/** Locked state: session is valid but this browser has no vault key. Password only. */
export function UnlockScreen({ username, notice = null }: { username: string; notice?: string | null }) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const wait = useCountdown();
  const form = useForm<z.input<typeof unlockSchema>>({ resolver: zodResolver(unlockSchema), defaultValues: { password: "" } });
  const { errors, isSubmitting } = form.formState;
  const blocked = wait.secondsLeft > 0;

  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      const retry = retryAfterOf(err);
      if (retry) wait.start(retry);
      setError(describeError(err, "unlock"));
      form.setValue("password", "");
      form.setFocus("password");
    }
  });

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <AuthFrame>
      <form onSubmit={submit} noValidate>
        <AuthHeading
          title="Vault locked"
          lead={
            <>
              Signed in as <span className="font-semibold text-foreground">{username}</span>. Enter your password to
              decrypt your codes on this device.
            </>
          }
        />
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        {notice ? (
          <p role="status" className="mb-5 rounded-sm bg-secondary px-4 py-2.5 text-[0.9375rem]">
            {notice} Your codes are encrypted again until you enter the password.
          </p>
        ) : null}
        <FieldGroup>
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
          <div id={`${id}-s`} aria-live="polite">
            {error ? (
              <p className="text-[0.9375rem] font-medium text-destructive">
                {error}
                {blocked ? ` Try again in ${wait.secondsLeft} s.` : null}
              </p>
            ) : null}
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || blocked || signingOut}>
            {isSubmitting ? "Unlocking your vault..." : "Unlock"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-11 self-start px-0 text-foreground underline"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
        </FieldGroup>
      </form>
    </AuthFrame>
  );
}
