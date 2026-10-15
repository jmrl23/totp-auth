/**
 * Sign-in flows. Zero knowledge: only authKey goes to the server, never the password or the
 * vault key. The vault key derived here is persisted as soon as the server accepts the credentials.
 */
import {
  DEFAULT_KDF_PARAMS,
  passwordSchema,
  recoveryKeySchema,
  usernameSchema,
  type EncryptedEntryInput,
  type SessionResponse,
} from "@/lib/schemas";
import { ApiError, api } from "./api";
import { deriveKeys, KdfError, newKdfSalt } from "./kdf";
import { setLocked, setSignedOut, setUnlocked } from "./lock-state";
import { decryptEntry, encryptEntry } from "./vault-crypto";

function invalid(message: string): ApiError {
  return new ApiError(0, "invalid_request", message);
}

async function derive(password: string, salt: string, params: SessionResponse["user"]["kdfParams"]) {
  try {
    return await deriveKeys(password, salt, params);
  } catch (error) {
    if (error instanceof KdfError) throw new ApiError(0, "crypto", error.message);
    throw error;
  }
}

function checkPassword(password: string): void {
  const p = passwordSchema.safeParse(password);
  if (!p.success) throw invalid(p.error.issues[0]?.message ?? "Enter a valid password.");
}

function checkUsername(username: string): string {
  const u = usernameSchema.safeParse(username);
  if (!u.success) throw invalid(u.error.issues[0]?.message ?? "Enter a valid username.");
  return u.data;
}

async function persist(vaultKey: CryptoKey): Promise<SessionResponse> {
  const session = await api.getSession();
  await setUnlocked(vaultKey, { id: session.user.id, username: session.user.username });
  return session;
}

/* ---------- registration ---------- */

/**
 * Derive keys with a fresh salt and create the account. The session is active on return and the
 * key is stored; resolves the recovery key (XXXXX-XXXXX-XXXXX-XXXXX), which the server shows only once.
 */
export async function register(input: { username: string; password: string; setupToken?: string }): Promise<string> {
  const username = checkUsername(input.username);
  checkPassword(input.password);
  const kdfSalt = newKdfSalt();
  const kdfParams = DEFAULT_KDF_PARAMS;
  const { authKey, vaultKey } = await derive(input.password, kdfSalt, kdfParams);
  const { recoveryKey } = await api.register({
    username,
    authKey,
    kdfSalt,
    kdfParams,
    ...(input.setupToken ? { setupToken: input.setupToken } : {}),
  });
  await persist(vaultKey);
  return recoveryKey;
}

/* ---------- login ---------- */

/** Prelogin (salt + params), derive, login; stores the key on success. */
export async function login(username: string, password: string): Promise<void> {
  const name = checkUsername(username);
  if (!password) throw invalid("Enter your password.");
  const { kdfSalt, kdfParams } = await api.prelogin({ username: name });
  const { authKey, vaultKey } = await derive(password, kdfSalt, kdfParams);
  await api.login({ username: name, authKey });
  await persist(vaultKey);
}

/**
 * Forgotten password: prove the recovery key and set a new password. The server erases the old
 * entries (their key is gone), so the vault starts empty. Resolves the NEW recovery key.
 */
export async function recoverAccount(input: {
  username: string;
  recoveryKey: string;
  newPassword: string;
}): Promise<string> {
  const username = checkUsername(input.username);
  const key = recoveryKeySchema.safeParse(input.recoveryKey);
  if (!key.success) throw invalid(key.error.issues[0]?.message ?? "Enter your recovery key.");
  checkPassword(input.newPassword);
  const kdfSalt = newKdfSalt();
  const kdfParams = DEFAULT_KDF_PARAMS;
  const { authKey, vaultKey } = await derive(input.newPassword, kdfSalt, kdfParams);
  const { recoveryKey } = await api.recover({
    username,
    recoveryKey: key.data,
    newAuthKey: authKey,
    newKdfSalt: kdfSalt,
    newKdfParams: kdfParams,
  });
  await persist(vaultKey);
  return recoveryKey;
}

/* ---------- lock / unlock / logout ---------- */

/** Re-derive from the password after Lock (active session required). */
export async function unlock(password: string): Promise<void> {
  if (!password) throw invalid("Enter your password.");
  const session = await api.getSession();
  const { authKey, vaultKey } = await derive(password, session.user.kdfSalt, session.user.kdfParams);
  await api.unlock({ authKey });
  await setUnlocked(vaultKey, { id: session.user.id, username: session.user.username });
}

/** Forget the vault key on this device (all tabs). The session stays signed in. */
export async function lock(): Promise<void> {
  await setLocked();
}

/** End the session on the server and forget the key everywhere. Never throws. */
export async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // Signed out locally regardless; the cookie expires on its own.
  }
  await setSignedOut();
}

/* ---------- account ---------- */

/**
 * Prove the password (authKey from the session's kdf salt/params) and replace the recovery key.
 * Resolves the new key. A wrong password throws invalid_credentials without signing out.
 */
export async function regenerateRecoveryKey(password: string): Promise<string> {
  if (!password) throw invalid("Enter your password.");
  const session = await api.getSession();
  const { authKey } = await derive(password, session.user.kdfSalt, session.user.kdfParams);
  const { recoveryKey } = await api.regenerateRecoveryKey({ authKey });
  return recoveryKey;
}

/**
 * Re-key the vault: verify the current password, decrypt every entry with the old key,
 * re-encrypt (same ids) with a key from a fresh salt, submit in one request, then store the new key.
 */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  if (!input.currentPassword) throw invalid("Enter your current password.");
  checkPassword(input.newPassword);
  const session = await api.getSession();
  const current = await derive(input.currentPassword, session.user.kdfSalt, session.user.kdfParams);
  // Check the current password before doing any re-encryption work.
  await api.unlock({ authKey: current.authKey });

  const { entries } = await api.getVault();
  const plains = [];
  for (const row of entries) {
    try {
      plains.push({ id: row.id, plain: await decryptEntry(current.vaultKey, row.id, row) });
    } catch {
      throw new ApiError(
        0,
        "crypto",
        "Some entries could not be decrypted, so the password was not changed. Export and remove them first.",
      );
    }
  }

  const freshSalt = newKdfSalt();
  const newKdfParams = DEFAULT_KDF_PARAMS;
  const next = await derive(input.newPassword, freshSalt, newKdfParams);
  const reencrypted: EncryptedEntryInput[] = [];
  for (const { id, plain } of plains) reencrypted.push(await encryptEntry(next.vaultKey, id, plain));

  await api.changePassword({
    currentAuthKey: current.authKey,
    newAuthKey: next.authKey,
    newKdfSalt: freshSalt,
    newKdfParams,
    entries: reencrypted,
  });
  await setUnlocked(next.vaultKey, { id: session.user.id, username: session.user.username });
}
