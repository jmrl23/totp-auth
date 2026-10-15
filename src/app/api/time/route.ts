import { json, route } from "@/lib/server/http";
import type { TimeResponse } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route({}, async () => json({ now: Date.now() } satisfies TimeResponse));
