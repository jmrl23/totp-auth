"use client";

import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ChevronRightIcon, EyeIcon } from "lucide-react";
import { ENTRY_DEFAULTS, OTP_ALGORITHMS, OTP_DIGITS, entryPlainSchema, type EntryPlain } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type FormIn = z.input<typeof entryPlainSchema>;

export const EMPTY_ENTRY: FormIn = {
  issuer: "",
  label: "",
  secret: "",
  algorithm: ENTRY_DEFAULTS.algorithm,
  digits: ENTRY_DEFAULTS.digits,
  period: ENTRY_DEFAULTS.period,
};

type Props = {
  defaults: FormIn;
  mode: "add" | "edit";
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (plain: EntryPlain) => Promise<string | null>;
  onBack?: () => void;
  backLabel?: string;
  /** Edit mode: the secret stays hidden until "Show secret" is pressed. */
  hideSecret?: boolean;
  autoFocusIssuer?: boolean;
};

/** Review form shared by Scan, Paste link, Enter manually and Edit. Validated with entryPlainSchema. */
export function EntryForm({
  defaults,
  mode,
  submitLabel,
  pendingLabel,
  onSubmit,
  onBack,
  backLabel = "Back",
  hideSecret = false,
  autoFocusIssuer = true,
}: Props) {
  const ids = { issuer: useId(), label: useId(), secret: useId(), alg: useId(), digits: useId(), period: useId(), err: useId() };
  const [revealed, setRevealed] = useState(!hideSecret);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<FormIn, unknown, EntryPlain>({
    resolver: zodResolver(entryPlainSchema),
    defaultValues: defaults,
  });
  const { errors, isSubmitting } = form.formState;
  const [algorithm, digits, period] = useWatch({ control: form.control, name: ["algorithm", "digits", "period"] });
  const advancedInvalid = !!(errors.algorithm || errors.digits || errors.period);
  const showAdvanced = advancedOpen || advancedInvalid;

  const submit = form.handleSubmit(async (plain) => {
    setSubmitError(null);
    const message = await onSubmit(plain);
    if (message) setSubmitError(message);
  });

  return (
    <form onSubmit={submit} noValidate className="pb-1">
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.issuer || undefined}>
          <FieldLabel htmlFor={ids.issuer}>Service</FieldLabel>
          <Input
            id={ids.issuer}
            autoComplete="off"
            autoFocus={autoFocusIssuer}
            placeholder="GitHub"
            aria-invalid={!!errors.issuer || undefined}
            aria-describedby={errors.issuer ? `${ids.issuer}-e` : undefined}
            {...form.register("issuer")}
          />
          <FieldError id={`${ids.issuer}-e`} errors={[errors.issuer]} />
        </Field>
        <Field data-invalid={!!errors.label || undefined}>
          <FieldLabel htmlFor={ids.label}>
            Account <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input
            id={ids.label}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            aria-invalid={!!errors.label || undefined}
            aria-describedby={errors.label ? `${ids.label}-e` : undefined}
            {...form.register("label")}
          />
          <FieldError id={`${ids.label}-e`} errors={[errors.label]} />
        </Field>
        <Field data-invalid={!!errors.secret || undefined}>
          <FieldLabel htmlFor={ids.secret}>Secret</FieldLabel>
          {revealed ? (
            <Input
              id={ids.secret}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="JBSW Y3DP EHPK 3PXP"
              className="tnum tracking-[0.06em] uppercase"
              aria-invalid={!!errors.secret || undefined}
              aria-describedby={`${ids.secret}-d${errors.secret ? ` ${ids.secret}-e` : ""}`}
              {...form.register("secret")}
            />
          ) : (
            <div className="flex items-center gap-2">
              <p className="flex h-11 flex-1 items-center rounded-lg border border-input px-3 text-muted-foreground">
                <span aria-hidden="true" className="tracking-[0.2em]">
                  •••• •••• •••• ••••
                </span>
                <span className="sr-only">Secret hidden</span>
              </p>
              <Button type="button" variant="outline" onClick={() => setRevealed(true)}>
                <EyeIcon aria-hidden="true" />
                Show secret
              </Button>
            </div>
          )}
          <FieldDescription id={`${ids.secret}-d`}>
            {mode === "edit"
              ? "Change the secret only if the service issued a new one."
              : "Base32 letters A to Z and digits 2 to 7. Spaces are ignored."}
          </FieldDescription>
          <FieldError id={`${ids.secret}-e`} errors={[errors.secret]} />
        </Field>

        <div className="border-t pt-1">
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls={`${ids.alg}-panel`}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex min-h-11 w-full items-center gap-2 rounded-sm text-left text-sm font-semibold"
          >
            <ChevronRightIcon aria-hidden="true" className={cn("size-4 transition-transform", showAdvanced && "rotate-90")} />
            Advanced
            <span className="tnum ml-auto font-normal text-muted-foreground">
              {String(algorithm).replace("SHA", "SHA-")}, {digits} digits, {Number.isFinite(period) ? period : "?"} s
            </span>
          </button>
          <div id={`${ids.alg}-panel`} hidden={!showAdvanced} className="grid gap-4 pt-2 pb-1 sm:grid-cols-3">
            <Field data-invalid={!!errors.algorithm || undefined}>
              <FieldLabel htmlFor={ids.alg}>Algorithm</FieldLabel>
              <Controller
                control={form.control}
                name="algorithm"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={ids.alg} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OTP_ALGORITHMS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a.replace("SHA", "SHA-")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field data-invalid={!!errors.digits || undefined}>
              <FieldLabel htmlFor={ids.digits}>Digits</FieldLabel>
              <Controller
                control={form.control}
                name="digits"
                render={({ field }) => (
                  <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger id={ids.digits} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OTP_DIGITS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field data-invalid={!!errors.period || undefined}>
              <FieldLabel htmlFor={ids.period}>Period (seconds)</FieldLabel>
              <Input
                id={ids.period}
                type="number"
                inputMode="numeric"
                min={10}
                max={120}
                step={1}
                className="tnum"
                aria-invalid={!!errors.period || undefined}
                aria-describedby={errors.period ? `${ids.period}-e` : undefined}
                {...form.register("period", { valueAsNumber: true })}
              />
              <FieldError id={`${ids.period}-e`}>
                {errors.period ? "Use a whole number from 10 to 120." : null}
              </FieldError>
            </Field>
          </div>
          <p className="pb-1 text-sm text-muted-foreground" hidden={showAdvanced}>
            Most services use the defaults. Change them only if the service says so.
          </p>
        </div>

        <div id={ids.err} aria-live="polite">
          {submitError ? <p className="text-[0.9375rem] font-medium text-destructive">{submitError}</p> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onBack ? (
            <Button type="button" variant="outline" onClick={onBack}>
              {backLabel}
            </Button>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? pendingLabel : submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
