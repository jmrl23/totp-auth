# totp-auth architecture (contract for implementers)

Personal, self-hosted web authenticator. One person, one instance. Read `PRODUCT.md` for product truth.
**Next.js is v16.4 with breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code** (`proxy.ts` replaces middleware; async `cookies()`/`headers()`/`params`; `cacheComponents` is OFF in this project).
Wire contract: `src/lib/schemas.ts` (Zod v4). Client surface: `src/lib/client/types.ts`. Do not change either without telling the orchestrator.

## Stack
Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui (radix-nova, components already in `src/components/ui`), Postgres 17 (docker compose, port 5433), Drizzle ORM + `pg`, Zod v4, `otpauth`, `@node-rs/argon2` (server), `hash-wasm` (browser Argon2id), TanStack Query, react-hook-form, `qrcode.react`, `jsqr`, `idb-keyval`, vitest, Playwright. Node 24.

## Threat model and crypto
Server must never be able to read the vault. Browser holds the only key.

1. **Client KDF.** `Argon2id(NFKC(password), salt = 16 random bytes, m=65536 KiB, t=3, p=1, out=64 bytes)` in a Web Worker (hash-wasm). `out[0..32)` -> `authKey` (base64url, sent to server). `out[32..64)` -> AES-256-GCM `vaultKey`, imported **non-extractable**; raw bytes are zeroed.
2. **Server auth hash.** Server stores `argon2id(authKey)` (`@node-rs/argon2`, defaults) as `auth_hash`. Verification is constant-time. Unknown usernames get a decoy salt `HMAC(SERVER_PEPPER, "decoy:"+username)[0..16)` and a dummy hash verification so timing and responses match.
3. **Vault entries.** Plaintext = JSON of `EntryPlain`. Encrypted in the browser with AES-256-GCM, fresh random 12-byte IV, **AAD = `totp-auth:v1:entry:<entryId>`**. Server stores `ciphertext`+`iv` (base64url) only. Entry ids are client-generated UUIDs.
4. **Key at rest in the browser.** The non-extractable `CryptoKey` is stored in IndexedDB (`idb-keyval`, db `totp-auth`, key `vault-key`, with `{userId, username}`) so reloads stay unlocked. `lock()` and `logout()` delete it. A missing key with a valid session = `locked` state; the unlock screen re-derives from the password and calls `POST /api/auth/unlock`.
5. **No second factor.** Sign-in is username and password. The account is as strong as the password, so the UI asks for 12+ characters and shows a strength hint.
6. **Recovery key.** One per account: 20 chars Crockford base32 (shown `XXXXX-XXXXX-XXXXX-XXXXX`, 100 bits), CSPRNG, issued at registration and downloaded by the user. The server stores `HMAC-SHA256(SERVER_PEPPER, key)` (+ issue time) only. `POST /api/auth/recover` verifies it, then sets a new password. **It cannot recover the vault**: the vault key comes from the old password and the server cannot re-wrap it, so recovery deletes every entry, signs out all sessions and issues a fresh key (the old one stops working). The UI must say so before the user confirms. Regenerating from the Account menu needs the password.
7. **Sessions.** 32-byte random token in an HttpOnly, SameSite=Strict, Path=/ cookie (`__Host-sid` when `APP_ORIGIN` is https, else `sid`). DB stores `sha256(token)`. One kind of session: 14 days absolute, 3 days idle sliding. Token is rotated on password change and recovery. Logout deletes the row.
8. **CSRF/origin.** Every non-GET API request must carry `Origin` equal to `APP_ORIGIN` and `Content-Type: application/json`; otherwise 403.
9. **Rate limiting.** Postgres-backed fixed window (`rate_limits`). Keys: per IP and per username for prelogin/login/recover/unlock/register; per user for recovery-key regenerate and password change. Client IP comes from `x-forwarded-for` only when `TRUST_PROXY=true`, otherwise one shared "unknown" bucket. Failures return 429 with `Retry-After` and `retryAfter` seconds.
10. **Registration.** Open only while zero accounts exist, or when `ALLOW_REGISTRATION=true`. The account is created and signed in by one request, under an advisory lock so the first account wins. Optional `SETUP_TOKEN` env: when set, `setupToken` must match (constant-time). `GET /api/auth/config` reports `{registrationOpen, setupTokenRequired}`. The response carries the recovery key once; the UI requires the user to download it and tick "I saved it" before continuing.
11. **Headers.** `src/proxy.ts` sets a strict nonce CSP (script-src `'self' 'nonce-X' 'strict-dynamic' 'wasm-unsafe-eval'`, plus `'unsafe-eval'` only in dev; `worker-src 'self' blob:`; `connect-src 'self'`; `img-src 'self' data: blob:`; `style-src 'self' 'nonce-X'` (dev may add `'unsafe-inline'`); `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src 'none'`), HSTS (https only), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, COOP `same-origin`. API responses: `Cache-Control: no-store`. `poweredByHeader: false`.
12. **Time.** `GET /api/time` returns server epoch ms. Client computes `offset = serverNow + rtt/2 - clientNow` and generates codes with corrected time. If `|offset| > 2000 ms` the UI shows a drift notice.
13. **Logging.** Never log secrets, authKey, codes, tokens, ciphertext. Structured one-line errors only.

## Database (Drizzle, `src/db`)
- `users`: id uuid pk (default gen_random_uuid), username text unique (lowercased), kdf_salt text, kdf_params jsonb, auth_hash text, recovery_key_hash text, recovery_key_created_at timestamptz, created_at.
- `sessions`: id text pk (sha256 hex of token), user_id fk cascade, created_at, last_seen_at, expires_at, user_agent text null; index on user_id, expires_at.
- `entries`: id uuid pk (client supplied), user_id fk cascade, ciphertext text, iv text, created_at, updated_at; index on user_id.
- `rate_limits`: key text pk, count int, reset_at timestamptz.
Migrations: `drizzle-kit generate` into `drizzle/`, applied at server start from `src/instrumentation.ts` (nodejs runtime only) under `pg_advisory_lock`. Expired sessions and rate-limit rows are pruned opportunistically.

## HTTP API (all JSON, all `no-store`; errors `ApiErrorBody`)
Public: `GET /api/time`, `GET /api/auth/config`, `POST /api/auth/prelogin`, `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/recover`.
Needs a session: `GET /api/auth/session`, `POST /api/auth/unlock`, `POST /api/auth/logout`, `POST /api/account/recovery-key`, `POST /api/account/password`, `GET /api/vault`, `POST /api/vault/entries`, `PUT|DELETE /api/vault/entries/[id]`, `POST /api/vault/import`.
Request/response bodies: see `src/lib/schemas.ts` comments. Generic auth failure body for bad username or password: `401 invalid_credentials` "Wrong username or password." Max `MAX_ENTRIES_PER_USER` entries (409-style `limit_reached` as 409).
All user-scoped queries filter by session user id. Update/delete of another user's id returns 404.

## Client library (`src/lib/client`, import from `@/lib/client`)
Implements `types.ts` plus:
- `deriveKeys(password, saltB64u, params): Promise<DerivedKeys>` (worker, main-thread fallback; throws `KdfError`), `newKdfSalt()`.
- `keyStore.{save,load,clear}` (never throw; save returns false when storage is unavailable); `useLockState(): LockState`, `getLockState()`, `refreshLockState()`.
- `encryptEntry(key, id, plain) -> {id, ciphertext, iv}`, `decryptEntry(key, id, {ciphertext, iv}) -> EntryPlain` (throws `VaultCryptoError`).
- `generateCode(entry, nowMs): CodeResult`, `formatCode(code)`, `parseOtpauthUri(uri): EntryPlain` (throws `OtpauthError` with a human message; rejects HOTP), `parseEntryInput(text)` (URI or bare base32 secret), `buildOtpauthUri(entry)`.
- `useNow(): number` (server-corrected epoch ms; one shared ticker, 100 ms, coarse 1000 ms under reduced motion; 0 during SSR), `useClockDrift(): { driftMs: number | null }`, `DRIFT_NOTICE_MS`.
- `api` object (typed fetch wrappers incl. `recover(...)`, `regenerateRecoveryKey({authKey})`; `getAuthConfig()` includes `closedReason`) and `ApiError` (`status`, `code: ClientErrorCode`, `message`, `retryAfter?`). `ClientErrorCode` = server codes + `network`, `invalid_response`, `session_expired`, `crypto`. A 401 `unauthorized` on an authenticated call signs the tab out.
- Flows: `register({username,password,setupToken?}) -> recoveryKey` (account is created and signed in, key persisted), `login(username,password) -> void`, `recoverAccount({username,recoveryKey,newPassword}) -> newRecoveryKey` (entries are erased server-side), `unlock(password)`, `lock()`, `logout()`, `regenerateRecoveryKey(password) -> string`, `changePassword({currentPassword,newPassword})`. `buildRecoveryKeyFile({username,recoveryKey,origin})` and `recoveryKeyFilename(username)` build the download.
- Auto-lock: `useAutoLock({ idleMinutes?, hiddenMinutes? })` (defaults `AUTO_LOCK_DEFAULTS = { idleMinutes: 10, hiddenMinutes: 5 }`; activity in any tab counts), pure `shouldLock(state, now, config)`, `createAutoLockController(...)`.
- TanStack Query: `QueryProvider`, `useSession()` (`data` null when signed out), `useVault(): { entries: VaultEntry[]; undecryptable; isLoading; error; refetch }` (decrypts, sorted by issuer then label, case-insensitive), `useAddEntry()` (`mutate(plain)`), `useUpdateEntry()` (`mutate({id, plain})`), `useDeleteEntry()` (`mutate(id)`), `useImportEntries()` (`mutate(plains) -> {created}`), all optimistic with rollback.
- `exportEntries(entries): string` (one `otpauth://` URI per line), `parseImportText(text, existing): ParsedImport`, `downloadTextFile(name, text)`.
- `startQrScan(video, onResult): Promise<stop>` camera helper (jsqr); rejects with `QrScanError` (`permission_denied`, `no_camera`, `camera_in_use`, `unsupported`, `insecure_context`, `unknown`).

## Product surface (UI) - Operate mode, mobile-first
Routes: `/` redirect; `/login` (username and password, "Forgot your password?" link); `/register` (account -> recovery key with Download and a required "I saved it" checkbox); `/recover` (username, recovery key, new password, "I understand my saved entries will be erased", then the new key); `/vault` (guarded server-side; locked state shows unlock form). Add/edit entry opens as a bottom drawer on phones and a dialog on desktop with tabs: Scan, Paste link, Enter manually. Account menu: Recovery key, Change password, Export, Import, Lock, Sign out.
Direction contract: see `.impeccable/` surface brief and `DESIGN.md` once written; summary: Swiss station timetable. Light off-white ground, black ink, ONE red used only for the expiring state, the primary action and the sweep-clock hand, grey secondary. Neo-grotesque (Inter Tight) with tabular figures. Rows are strict columns (issuer, account, code, valid-for) on desktop; on phones each entry is a full-width two-line row with the code largest. Each row has a small station-clock sweep hand: it sweeps for the period, holds at 12 for a beat, restarts. Tap or click a row to copy. Honour `prefers-reduced-motion` and WCAG 2.2 AA; countdown must not rely on colour alone (seconds shown as text).

## Quality bar
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` all green. No `any`, no secrets in logs, no TODO left behind. Every user-visible string is plain, specific language. Empty/loading/error states for every screen.
