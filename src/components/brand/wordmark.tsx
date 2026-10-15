import { cn } from "@/lib/utils";

/** Static station-clock glyph at 12:00 plus the product name. */
export function Wordmark({
  className,
  textClassName,
  as: Tag = "span",
}: {
  className?: string;
  textClassName?: string;
  as?: "span" | "p" | "h1";
}) {
  return (
    <Tag className={cn("inline-flex items-center gap-2 text-[1.1875rem] leading-none font-bold tracking-[-0.01em]", className)}>
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false" className="shrink-0">
        <circle cx="16" cy="16" r="14" className="fill-none stroke-current" strokeWidth="3" />
        <line x1="16" y1="18" x2="16" y2="6.5" className="stroke-primary" strokeWidth="3" strokeLinecap="square" />
      </svg>
      <span className={textClassName}>totp-auth</span>
    </Tag>
  );
}
