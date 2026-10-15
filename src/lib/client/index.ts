"use client";
/**
 * Public client library. The UI imports only from "@/lib/client".
 * Marked "use client" because it re-exports hooks; server components may still render QueryProvider.
 */
export type { CodeResult, DerivedKeys, EntryPlain, KdfParams, LockState, ParsedImport, VaultEntry } from "./types";

export { deriveKeys, newKdfSalt, KdfError } from "./kdf";
export { b64uDecode, b64uEncode } from "./encoding";
export { encryptEntry, decryptEntry, VaultCryptoError, type VaultCryptoErrorCode } from "./vault-crypto";
export { keyStore, type StoredKey } from "./key-store";
export { useLockState, getLockState, refreshLockState } from "./lock-state";
export {
  generateCode,
  formatCode,
  parseOtpauthUri,
  parseEntryInput,
  buildOtpauthUri,
  OtpauthError,
  type EntryInput,
} from "./totp";
export { useNow, useClockDrift, syncClock, DRIFT_NOTICE_MS } from "./clock";
export { api, createApi, ApiError, isApiError, NETWORK_MESSAGE, type Api, type ClientErrorCode } from "./api";
export {
  register,
  login,
  recoverAccount,
  unlock,
  lock,
  logout,
  regenerateRecoveryKey,
  changePassword,
} from "./auth-flows";
export { buildRecoveryKeyFile, recoveryKeyFilename } from "./recovery-file";
export {
  QueryProvider,
  useSession,
  useVault,
  useAddEntry,
  useUpdateEntry,
  useDeleteEntry,
  useImportEntries,
  sortEntries,
  type VaultData,
} from "./queries";
export { exportEntries, parseImportText, downloadTextFile } from "./import-export";
export { startQrScan, QrScanError, type QrScanErrorCode } from "./scan";
export {
  useAutoLock,
  shouldLock,
  createAutoLockController,
  AUTO_LOCK_DEFAULTS,
  type AutoLockConfig,
  type AutoLockState,
  type AutoLockController,
} from "./auto-lock";
