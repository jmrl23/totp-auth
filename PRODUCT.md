# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React / Next.js (user's choice from the stack round). Next.js is the concrete pick because the product needs server routes for account login; a plain React SPA would need a separate backend. Deploy target not stated; self-hosting is a stated goal, so the app must run from a single deployable unit (Docker or `next start`) with no vendor-specific services required.

## Users

Primary user: an individual managing their own two-factor authentication codes for the services they log in to. Personal use, not a team or workforce product. They enroll a new service by scanning a QR code or pasting a secret, and later read a live six- or eight-digit code to complete a login elsewhere. They use it from a desktop or laptop browser as well as a phone browser, so the device is whatever they have in hand at login time.

Secondary audience (same person, different hat): the self-hoster who deploys and maintains their own instance.

## Product Purpose

totp-auth is a self-hosted web authenticator. It stores a person's TOTP secrets behind an account, generates live codes from them, and lets the person sign in to the vault itself with a username and password. Success means the person can retire a phone-only authenticator app and trust this instance as the home for their codes: enrolling is easy, codes are always correct and in sync with the server clock, and nothing about the data is locked to a vendor.

## Positioning

Open and self-hostable with no vendor lock-in, built for one person's own use rather than a hosted multi-tenant service. The person owns the instance and the data: secrets can be exported and imported freely, and no third-party account is required. Incumbents (Google Authenticator, Authy, password-manager TOTP) either tie codes to a phone or to a vendor cloud; totp-auth does neither.

## Operating Context

- The person is usually mid-login on another site when they open totp-auth. Reading the right code quickly, with the remaining validity window visible, is the core moment.
- Enrollment happens when a service shows an `otpauth://` QR code or a base32 secret. The person scans it with a camera (phone browser) or pastes the URI or secret (desktop browser).
- Codes follow RFC 6238 (TOTP) over RFC 4226 (HOTP): SHA-1 default, 30-second period default, 6 digits default, with 8 digits and SHA-256/SHA-512 as variants that real issuers use.
- The vault is gated by the person's own account: username and password. There is no second login factor; a downloadable recovery key restores account access after a forgotten password.
- The instance is self-hosted and may be reached over a home network or a personal domain. Clock drift between server and the person's device matters for code correctness; the server clock is authoritative for verification.

## Capabilities and Constraints

Confirmed in scope for the first version:

- Enroll an account entry via QR scan or pasted `otpauth://` URI or raw base32 secret.
- Generate and display live TOTP codes with a countdown to the next rotation.
- Verify a submitted code server-side against a stored secret.
- Sign-in flow for the vault: username and password. Forgotten password: recovery key, then a new password.
- Secrets are synced to the person's account and stored server-side; the login gates the vault.

Constraints and terminology:

- Secrets must be stored encrypted at rest. The encryption model (server-held key vs. key derived from the password so the server cannot read secrets) is not yet decided; see open decisions.
- No vendor lock-in: export and import of entries in a standard form (at minimum `otpauth://` URIs) is a product commitment even if not in the first build.
- "Entry" or "account" means one enrolled issuer plus secret. "Vault" means the set of entries behind the login. "Code" means the current TOTP value.
- Single-person instance. Multi-user, sharing, and organization features are out of scope.

Decided in shape (user-confirmed):

- Encryption: end-to-end. The key derives from the account password in the browser; the server stores ciphertext only. Codes are computed client-side. Forgetting the password loses the vault: the recovery key restores account access only.
- Hosting: Postgres plus Docker Compose.
- Recovery: one recovery key, downloaded at account setup. It sets a new password and erases the old vault (zero knowledge: the server cannot re-wrap it).
- Fidelity: production-ready, real auth, real RFC 6238 verification, encrypted storage.

Still open, recorded not invented:

- Whether export/import ships in the first version.

## Brand Commitments

Working name: totp-auth. No logo, domain, voice, or other brand assets exist yet. Nothing is binding beyond the name.

## Evidence on Hand

None. No real users, testimonials, screenshots, metrics, or press. The repository was empty at the time of this record. Future work must not fabricate adoption claims, comparisons with named incumbents beyond the factual positioning above, or security certifications.

## Product Principles

1. The code is the product. The current code and its remaining validity must be readable instantly, on any device, without hunting.
2. Correctness over cleverness. Codes must match the issuer's expectation exactly; RFC parameters are honored, and the server clock is authoritative.
3. The person owns the data. Nothing is locked in; export is a right, not a feature.
4. Security is legible. The login and enrollment flows should make it obvious what is protected and how, without security theater.
5. Built for one. Decisions favor a single self-hoster's convenience over multi-tenant generality.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Live codes must be readable by screen readers and must not rely on color alone to show the countdown. Code digits should be copyable and large enough to read at a glance on a phone held in one hand.
