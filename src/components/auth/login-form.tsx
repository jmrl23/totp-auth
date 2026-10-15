"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api, login } from "@/lib/client";
import { usernameSchema } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AuthHeading } from "@/components/auth/auth-frame";
import { PasswordInput } from "@/components/auth/password-input";
import { describeError, retryAfterOf } from "@/components/common/errors";
import { useCountdown } from "@/hooks/use-countdown";

const passwordStepSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Enter your password."),
});
type PasswordStep = z.input<typeof passwordStepSchema>;

export function LoginForm() {
  const router = useRouter();
  const config = useQuery({ queryKey: ["auth-config"], queryFn: () => api.getAuthConfig(), staleTime: 60_000 });

  return (
    <>
      <PasswordStepForm
        onDone={() => {
          router.replace("/vault");
          router.refresh();
        }}
      />
      {config.data?.registrationOpen ? (
        <p className="mt-8 border-t pt-6 text-[0.9375rem] text-muted-foreground">
          New instance?{" "}
          <Link href="/register" className="font-semibold text-foreground underline">
            Create the account
          </Link>
        </p>
      ) : null}
    </>
  );
}

function PasswordStepForm({ onDone }: { onDone: () => void }) {
  const ids = { username: useId(), password: useId(), error: useId() };
  const [error, setError] = useState<string | null>(null);
  const wait = useCountdown();
  const form = useForm<PasswordStep, unknown, z.output<typeof passwordStepSchema>>({
    resolver: zodResolver(passwordStepSchema),
    defaultValues: { username: "", password: "" },
  });
  const { isSubmitting, errors } = form.formState;
  const blocked = wait.secondsLeft > 0;

  const onSubmit = form.handleSubmit(async ({ username, password }) => {
    setError(null);
    try {
      await login(username, password);
      onDone();
    } catch (err) {
      const retry = retryAfterOf(err);
      if (retry) wait.start(retry);
      setError(describeError(err, "login"));
      form.setValue("password", "");
      form.setFocus("password");
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-describedby={error ? ids.error : undefined}>
      <AuthHeading title="Sign in" lead="Your password unlocks the vault on this device. The server never sees it." />
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
            aria-describedby={errors.username ? `${ids.username}-e` : undefined}
            {...form.register("username")}
          />
          <FieldError id={`${ids.username}-e`} errors={[errors.username]} />
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor={ids.password}>Password</FieldLabel>
          <PasswordInput
            id={ids.password}
            autoComplete="current-password"
            aria-invalid={!!errors.password || undefined}
            aria-describedby={errors.password ? `${ids.password}-e` : undefined}
            {...form.register("password")}
          />
          <FieldError id={`${ids.password}-e`} errors={[errors.password]} />
        </Field>
        <div aria-live="polite" id={ids.error}>
          {error ? (
            <p className="text-[0.9375rem] font-medium text-destructive">
              {error}
              {blocked ? ` Try again in ${wait.secondsLeft} s.` : null}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting || blocked} className="w-full">
          {isSubmitting ? "Unlocking your vault..." : blocked ? `Wait ${wait.secondsLeft} s` : "Sign in"}
        </Button>
        <p className="text-[0.9375rem] text-muted-foreground">
          <Link href="/recover" className="font-semibold text-foreground underline">
            Forgot your password?
          </Link>
        </p>
        <p aria-live="polite" className="sr-only">
          {isSubmitting ? "Unlocking your vault. This takes about a second." : ""}
        </p>
      </FieldGroup>
    </form>
  );
}
