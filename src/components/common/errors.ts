import { ApiError, type ClientErrorCode } from "@/lib/client";

/**
 * Where the request was made. The same server code can mean different things to the person:
 * `invalid_credentials` is "wrong username or password" at sign-in, "username and recovery key do not
 * match" on the recover page, but "wrong password" after sign-in.
 * - recover: forgotten-password page (username, recovery key, new password)
 * - import: bulk import
 */
export type ErrorContext = "login" | "recover" | "unlock" | "register" | "account" | "vault" | "import";

/** Rate-limit wait in seconds when the error is a 429, else null. */
export function retryAfterOf(err: unknown): number | null {
  if (err instanceof ApiError && err.code === "rate_limited") {
    return Math.max(1, Math.ceil(err.retryAfter ?? 30));
  }
  return null;
}

/** Plain, specific message for every error code the client library can raise. */
export function messageFor(code: ClientErrorCode, context: ErrorContext, err: ApiError): string {
  switch (code) {
    case "invalid_credentials":
      if (context === "login") return "Wrong username or password.";
      if (context === "recover") return "That username and recovery key do not match. Check both and try again.";
      return "That password is not correct.";
    case "rate_limited":
      return err.retryAfter ? "Too many attempts." : "Too many attempts. Wait a little, then try again.";
    case "unauthorized":
      return "Your session ended. Sign in again.";
    case "invalid_request":
      return "The server did not accept the request. Check the fields and try again.";
    case "forbidden":
      return context === "register"
        ? "The setup token is not correct. Copy the SETUP_TOKEN value from the server again."
        : "The server refused this request. Reload the page and try again.";
    case "not_found":
      if (context === "vault") return "That entry no longer exists. It may have been deleted on another device.";
      return "The server could not find what this request refers to. Reload the page and try again.";
    case "conflict":
      if (context === "register") return "That username is taken. Choose another.";
      if (context === "vault" || context === "import") return "An entry with the same id already exists. Try again.";
      return "This changed on the server in the meantime. Reload the page and try again.";
    case "registration_closed":
      return "Registration is closed on this instance.";
    case "limit_reached":
      return "This vault already holds the maximum of 500 entries. Delete one before adding another.";
    case "payload_too_large":
      return context === "import"
        ? "That is too much to send at once. Import fewer lines at a time."
        : "That is more data than the server accepts in one request. Shorten it and try again.";
    case "server_error":
      return "The server hit a problem and could not finish. Try again in a moment; if it keeps happening, check the server log.";
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    case "invalid_response":
      return "The server sent a response this page does not understand. Reload the page; if it persists, the app and server versions may not match.";
    case "crypto":
      return context === "unlock" || context === "login"
        ? "This browser could not derive the key or decrypt the vault. Reload the page and try again."
        : "Encryption failed in this browser. Reload the page and try again.";
    default: {
      const unhandled: never = code;
      return unhandled;
    }
  }
}

export function describeError(err: unknown, context: ErrorContext): string {
  if (err instanceof ApiError) return messageFor(err.code, context, err);
  if (err instanceof TypeError) return "Could not reach the server. Check your connection and try again.";
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}
