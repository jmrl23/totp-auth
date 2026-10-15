import { errors } from "@/lib/server/errors";
import { noContent, route } from "@/lib/server/http";
import { verifyAuthKey } from "@/lib/server/password";
import { attempt, failureLimits } from "@/lib/server/rate-limit";
import { getUserById } from "@/lib/server/users";
import { unlockRequestSchema } from "@/lib/schemas";

/** 204 when the password (authKey) is right. */
export const POST = route({ auth: "active" }, async ({ session, body, ip }) => {
  const { authKey } = await body(unlockRequestSchema);
  const user = await getUserById(session.userId);
  if (!user) throw errors.unauthorized();
  const { limits, userIpKey } = failureLimits("unlock", user.username, ip);
  const pending = await attempt(limits);
  if (!(await verifyAuthKey(user.authHash, authKey))) throw errors.wrongPassword();
  await pending.succeeded([userIpKey]);
  return noContent();
});
