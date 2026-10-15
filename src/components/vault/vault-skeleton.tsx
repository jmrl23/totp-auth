import { Skeleton } from "@/components/ui/skeleton";
import { Wordmark } from "@/components/brand/wordmark";

const ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"];

/** Skeleton timetable rows. Server-safe (no hooks) so loading.tsx can use it. */
export function SkeletonRows({ label = "Loading your vault" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true">
      <ul className="flex flex-col gap-0.5">
        {ROWS.map((id) => (
          <li key={id} className="entry-grid min-h-[4.5rem] bg-row py-3 pr-14 pl-4 odd:bg-row-alt md:min-h-[4.75rem]">
            <Skeleton className="ga-issuer h-4 w-28" />
            <Skeleton className="ga-account h-3.5 w-36 md:w-48" />
            <Skeleton className="ga-code h-8 w-28 md:h-9 md:w-40" />
            <span className="ga-timer">
              <Skeleton className="ga-clock size-[22px] rounded-full md:size-8" />
              <Skeleton className="ga-secs h-3 w-6" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Full-screen placeholder shown while the lock state is being checked. */
export function VaultSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="surface-bar pad-safe-top">
        <div className="pad-safe-x mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 pt-2 pb-3 md:h-16 md:flex-nowrap md:gap-6 md:px-6 md:py-0 lg:px-12">
          <span className="mr-auto flex h-11 items-center md:mr-0 md:w-52">
            <Wordmark />
          </span>
          <span className="order-last h-11 basis-full rounded-sm bg-bar-field md:order-none md:basis-auto md:flex-1" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 pt-3 md:px-6 lg:px-12">
        <SkeletonRows />
      </main>
    </div>
  );
}
