"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { parseOtpauthUri } from "@/lib/client";
import { ENTRY_DEFAULTS, normalizeSecret, type EntryPlain } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

const pasteSchema = z.object({ text: z.string().trim().min(1, "Paste an otpauth:// link or a secret.") });

const BASE32 = /^[A-Z2-7]{16,128}$/;

/** Accepts an otpauth:// link (parsed by the client library) or a bare base32 secret. */
export function PastePanel({ onParsed }: { onParsed: (plain: EntryPlain) => void }) {
  const id = useId();
  const form = useForm<z.input<typeof pasteSchema>>({ resolver: zodResolver(pasteSchema), defaultValues: { text: "" } });
  const { errors } = form.formState;

  const submit = form.handleSubmit(({ text }) => {
    const value = text.trim();
    if (/^otpauth:\/\//i.test(value)) {
      try {
        onParsed(parseOtpauthUri(value));
      } catch (err) {
        form.setError("text", { message: err instanceof Error ? err.message : "That link could not be read." });
      }
      return;
    }
    const secret = normalizeSecret(value);
    if (BASE32.test(secret)) {
      onParsed({ issuer: "", label: "", secret, ...ENTRY_DEFAULTS });
      return;
    }
    form.setError("text", {
      message: "This is neither an otpauth:// link nor a base32 secret. Copy the setup link or the text key the service shows.",
    });
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field data-invalid={!!errors.text || undefined}>
        <FieldLabel htmlFor={id}>Setup link or secret</FieldLabel>
        <Textarea
          id={id}
          rows={3}
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="otpauth://totp/GitHub:you?secret=..."
          className="min-h-24 font-mono text-sm break-all"
          aria-invalid={!!errors.text || undefined}
          aria-describedby={`${id}-d${errors.text ? ` ${id}-e` : ""}`}
          {...form.register("text")}
        />
        <FieldDescription id={`${id}-d`}>
          Most services offer a link or a text key next to the QR code, often under &ldquo;Can&apos;t scan?&rdquo;.
        </FieldDescription>
        <FieldError id={`${id}-e`} errors={[errors.text]} />
      </Field>
      <Button type="submit" className="w-full">
        Continue
      </Button>
    </form>
  );
}
