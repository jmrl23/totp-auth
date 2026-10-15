import { json, route } from "@/lib/server/http";
import { decoyKdfParams, decoySalt } from "@/lib/server/password";
import { lim, LIMITS } from "@/lib/server/rate-limit";
import { findUserByUsername } from "@/lib/server/users";
import { preloginRequestSchema, type PreloginResponse } from "@/lib/schemas";

export const POST = route(
  { limits: ({ ip }) => [lim(`prelogin:ip:${ip}`, LIMITS.prelogin.ip)] },
  async ({ body }) => {
    const { username } = await body(preloginRequestSchema);
    const user = await findUserByUsername(username);
    // Unknown users get a stable decoy so the response does not reveal existence.
    const res: PreloginResponse = user
      ? { kdfSalt: user.kdfSalt, kdfParams: user.kdfParams }
      : { kdfSalt: decoySalt(username), kdfParams: decoyKdfParams() };
    return json(res);
  },
);
