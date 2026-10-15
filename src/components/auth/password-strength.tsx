import { PASSWORD_MIN_LENGTH } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/** Length-based hint only: length is what matters most for a passphrase that never leaves the device. */
export function strengthOf(length: number): { level: 0 | 1 | 2 | 3; text: string } {
  if (length === 0) return { level: 0, text: `Use at least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.` };
  if (length < PASSWORD_MIN_LENGTH)
    return { level: 0, text: `Too short: ${PASSWORD_MIN_LENGTH - length} more character${PASSWORD_MIN_LENGTH - length === 1 ? "" : "s"} needed.` };
  if (length < 16) return { level: 1, text: "Acceptable. Longer is stronger." };
  if (length < 20) return { level: 2, text: "Good length." };
  return { level: 3, text: "Strong length." };
}

export function PasswordStrength({ length, id }: { length: number; id: string }) {
  const { level, text } = strengthOf(length);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={cn("h-1 rounded-[1px]", level >= n ? "bg-foreground" : "bg-border")} />
        ))}
      </div>
      <p id={id} aria-live="polite" className="text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  );
}
