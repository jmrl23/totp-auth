/** Plain-text recovery key file the person downloads and keeps somewhere safe. */

/** Lowercase, filename-safe form of the username. */
export function recoveryKeyFilename(username: string): string {
  const safe = username.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `totp-auth-recovery-key-${safe}.txt`;
}

export function buildRecoveryKeyFile(input: { username: string; recoveryKey: string; origin: string; now?: Date }): string {
  const issued = (input.now ?? new Date()).toISOString().slice(0, 10);
  return [
    "totp-auth recovery key",
    "",
    `Account: ${input.username}`,
    `Instance: ${input.origin}`,
    `Issued: ${issued}`,
    "",
    `Recovery key: ${input.recoveryKey}`,
    "",
    "Use it on the Forgot your password page to set a new password.",
    "It restores access to the account only. Your saved entries are erased, because the server cannot decrypt them.",
    "Anyone with this file can take over the account. Keep it private, and make a new key if it leaks.",
    "",
  ].join("\n");
}
