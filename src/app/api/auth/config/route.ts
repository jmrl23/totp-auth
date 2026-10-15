import { json, route } from "@/lib/server/http";
import { registrationStatus } from "@/lib/server/users";
import type { AuthConfigResponse } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ env }) => {
  const status = await registrationStatus(env);
  const body: AuthConfigResponse = {
    registrationOpen: status.open,
    setupTokenRequired: env.SETUP_TOKEN !== undefined,
  };
  if (!status.open) body.closedReason = status.reason;
  return json(body);
});
