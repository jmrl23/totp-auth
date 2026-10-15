import { cn } from "@/lib/utils";

/**
 * Fraction of the period spent at rest at 12 right AFTER rotation (the station clock's beat).
 * The pause coincides with the new code appearing, so the hand never sits at 12 while an old
 * code is still live.
 */
export const HOLD_FRACTION = 0.05;

/** Hand angle in degrees for a 0..1 fraction of the period elapsed. */
export function handAngle(elapsed: number): number {
  const clamped = Math.min(Math.max(elapsed, 0), 1);
  return clamped < HOLD_FRACTION ? 0 : ((clamped - HOLD_FRACTION) / (1 - HOLD_FRACTION)) * 360;
}

const TICKS = Array.from({ length: 12 }, (_, i) => {
  const quarter = i % 3 === 0;
  return { id: `t${i * 30}`, angle: i * 30, quarter };
});

/**
 * Station-clock face for one entry. The hand angle derives from `elapsed` (0..1 of the period):
 * it rests at 12 for the first 5 % of the period (just after the code rotated), then sweeps one
 * full turn, arriving back at 12 exactly when the code rotates.
 * Rotation is an SVG transform attribute (no inline style, no CSS transition), so reduced-motion
 * ticks stay step-like and nothing is blocked by the strict CSP.
 */
export function SweepClock({
  elapsed,
  expiring,
  className,
}: {
  elapsed: number;
  expiring: boolean;
  className?: string;
}) {
  const angle = handAngle(elapsed);
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      data-expiring={expiring || undefined}
      className={cn("size-8 shrink-0", className)}
    >
      <circle
        cx="16"
        cy="16"
        r="14.25"
        strokeWidth="2.5"
        className={cn("fill-card", expiring ? "stroke-primary" : "stroke-foreground")}
      />
      {TICKS.map((t) => (
        <line
          key={t.id}
          x1="16"
          y1={t.quarter ? 3.6 : 4.2}
          x2="16"
          y2={t.quarter ? 7.4 : 5.8}
          strokeWidth={t.quarter ? 2.25 : 1}
          transform={`rotate(${t.angle} 16 16)`}
          className={cn("stroke-foreground", !t.quarter && "max-md:hidden")}
        />
      ))}
      <g transform={`rotate(${angle.toFixed(1)} 16 16)`}>
        <line x1="16" y1="19" x2="16" y2="4.5" strokeWidth="2.25" strokeLinecap="round" className="stroke-primary" />
        <circle cx="16" cy="6.25" r="2" className="fill-primary" />
      </g>
      <circle cx="16" cy="16" r="1.6" className="fill-foreground" />
    </svg>
  );
}
