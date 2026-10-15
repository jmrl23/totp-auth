---
version: 1
slug: "src-app-vault-page-tsx"
primary_target: "src/app/vault/page.tsx"
related_targets: []
---

# Surface brief: totp-auth app shell (Operate)

Scope: login, register, vault, add entry, account menu. Visitor mode: Operate. A person mid-login on another site needs one correct code in about a second, on a phone or laptop.

Proof and content: synthetic demo issuers only in tests and screenshots (GitHub, Cloudflare, AWS root, Fastmail, Hetzner, Mastodon, Proton, Namecheap). No invented customers or claims.

Chosen direction: Swiss station timetable. Codes are set as departures in strict columns. Signature move: a station-clock sweep hand per row. The hand sweeps for the full period, holds at 12 for a beat, then restarts. The last 5 seconds turn the row red.

## Direction contract

THESIS: A code is a departure. The vault is a timetable read in one glance, and rotation is a clock hand, not a spinner. Refuses the rounded-card authenticator grid and the dark hacker-terminal vault.

OWN-WORLD: Off-white ground (#f3f3f0), black ink (#111), one signal red (#e30613) used only for the expiring row, the primary action and the clock hand, warm grey (#6b6b66) for secondary text. Neo-grotesque (Inter Tight) with tabular figures, strict columns, flat fills, square-to-4px corners, tone steps instead of shadows. Dark mode inverts ground and ink and keeps the same single red.

STORY: The visitor understands that every code on screen is live, which one is about to change, and that tapping a row copies it. They believe the vault is calm and exact. They copy a code and go back to the other site.

FIRST VIEWPORT: Desktop: black top bar with wordmark left, search field filling the middle, red Add entry button right. Below it a column header row (Issuer, Account, Code, Valid for), then one row per entry, 76px tall, alternating tone steps, code at 46px bold tabular. Phone: same top bar compressed to wordmark, search and a red icon button; each entry is a full-width two-line row, issuer over account on the left, code at 34px on the right, sweep clock beside it; tapping copies. The primary action is Add entry, top right on desktop and in the bar on phone.

FORM: Swiss station timetable, position 1 on the model's list and chosen as IMPECCABLE'S PICK. Seed key f8763b47.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions
None blocking. Chosen sketch: .impeccable/mocks/decision/model-pick.html
