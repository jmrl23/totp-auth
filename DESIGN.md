---
name: totp-auth
description: Swiss station timetable for live two-factor codes. Off-white ground, black ink, one signal red.
colors:
  ground: "#f3f3f0"
  ink: "#111111"
  row: "#ffffff"
  row-alt: "#ecece8"
  tone: "#e4e4df"
  rule: "#d6d6d0"
  control-edge: "#85857f"
  grey: "#63635e"
  signal-red: "#e30613"
  signal-red-pressed: "#c40511"
  signal-red-text: "#c00511"
  bar: "#111111"
  bar-ink: "#f3f3f0"
  bar-field: "#2a2a28"
  bar-grey: "#b5b5ae"
  dark-ground: "#111111"
  dark-ink: "#f3f3f0"
  dark-row: "#1a1a19"
  dark-row-alt: "#252524"
  dark-tone: "#262625"
  dark-rule: "#2e2e2c"
  dark-control-edge: "#6b6b66"
  dark-grey: "#a3a39c"
  dark-signal-red: "#ff3b45"
  dark-signal-red-text: "#ff5a62"
  dark-bar: "#000000"
  dark-bar-field: "#1d1d1c"
typography:
  code-desktop:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  code-tablet:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  code-phone:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, calc(2.125rem - (24.375rem - 100vw) * 0.143), 2.125rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
  code-8-desktop:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  code-8-tablet:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  code-8-phone:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, calc(1.75rem - (24.375rem - 100vw) * 0.114), 1.75rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  page-title:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  issuer:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.25
  issuer-tablet:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.25
  issuer-phone:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.25
  section-title:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  dialog-title:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
  wordmark:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  button-sm:
    fontFamily: "Inter Tight, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  hairline: "1px"
  sm: "2.4px"
  md: "3.2px"
  lg: "4px"
spacing:
  gap-rows: "2px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
  touch: "44px"
components:
  top-bar:
    backgroundColor: "{colors.bar}"
    textColor: "{colors.bar-ink}"
    height: "64px"
  search-field:
    backgroundColor: "{colors.bar-field}"
    textColor: "{colors.bar-ink}"
    rounded: "{rounded.sm}"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.row}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-red-pressed}"
  button-outline:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
  entry-row:
    backgroundColor: "{colors.row}"
    textColor: "{colors.ink}"
    height: "76px"
    padding: "12px 8px 12px 16px"
  entry-row-alt:
    backgroundColor: "{colors.row-alt}"
  entry-code-expiring:
    textColor: "{colors.signal-red}"
  sweep-clock:
    backgroundColor: "{colors.row}"
    textColor: "{colors.ink}"
    size: "28px"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
  dialog:
    backgroundColor: "{colors.row}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "20px"
---

# totp-auth design system

## Overview

**Creative North Star: "The Station Timetable"**

A code is a departure. The vault reads like a Swiss station timetable: strict columns, black type on an off-white ground, one red that means "act now". Rotation is shown by a station-clock sweep hand per row, never a spinner or a progress ring. Every screen is an Operate surface: the person is usually mid-login elsewhere and needs one correct code in about a second, so the world only lends type, palette, density and the clock; navigation and controls are the standard web ones (shadcn/ui on Radix).

Mobile-first. Designed at 390px, verified at 320px (no horizontal scroll) and widened to strict columns from 768px. Light and dark follow `prefers-color-scheme` only; there is no theme switch.

**The Departure Board Rule.** The code is always the largest thing on screen. Nothing else in a row may compete with it in size or weight.

## Colors

Roles, not hues. Light values first; dark mode inverts ground and ink and keeps the same single red, lifted for AA.

- **Ground** (`ground`): the page. Off-white, never pure white, so rows can step up to white.
- **Ink** (`ink`): all primary text, the clock ring and ticks, focus rings, the selection highlight.
- **Row and row-alt** (`row`, `row-alt`): timetable rows alternate between these two tones, separated by a 2px gap of ground. This is the only "surface" system; there are no cards.
- **Tone** (`tone`): secondary fills (tabs track, outline hover, quiet notices such as the 500-entry limit and the undecryptable-entries notice).
- **Rule** (`rule`): hairline separators. **Control edge** (`control-edge`): input and checkbox borders, 3.4:1 against ground for WCAG 1.4.11.
- **Grey** (`grey`): secondary text (account names, descriptions, "Valid for" seconds, column headers). 5.4:1 on ground, 5.0:1 on row-alt.
- **Signal red** (`signal-red`): fills and large type only (primary buttons, the expiring code at 24px+, the clock hand and its disc). 4.9:1 for white text on red. **Signal red text** (`signal-red-text`) is the darker red used for small red text: form errors and the expiring seconds label (5.7:1).
- **Bar** (`bar`, `bar-ink`, `bar-field`, `bar-grey`): the black top bar. It carries its own ink, focus ring and field tone in both schemes (in dark mode it drops to pure black).

**The One Red Rule.** Red is spent on exactly three things: the primary action, the expiring state, and the clock hand. Errors use the text red because they are a state, not decoration. No red borders, red headings, red icons or red badges anywhere else.

**The Never Colour Alone Rule.** Every red state is paired with text: the seconds remaining are always printed ("4 s"), and errors are written sentences.

## Typography

One family: Inter Tight (self-hosted through `next/font`, CSS variable `--font-inter-tight`, mapped to the Tailwind `font-sans` token). All digits that update or line up use tabular figures (`tnum` utility: `font-variant-numeric: tabular-nums`), so codes and seconds never jitter as they change.

Scale (see frontmatter): code 46 / 38 / 34-to-24px fluid on phones (34px from 390px, 24px at 320px); 8-digit codes one step smaller (40 / 32 / 28-to-20px). Page title 28px, issuer 22 / 19 / 17px, section title 20px, dialog title 18px, wordmark 19px, body 15px, label 14px, small button 12.8px. Body text carries a max(0.05em, 1px) word space because Inter Tight's default word space reads as run-together words at 13-15px; codes reset it to 0. The phone hint "Tap a row to copy its code." disappears after the first successful copy (remembered per browser). Weights are 400 and 700 only, with 500/600 reserved for labels and button text.

**The Grouped Digits Rule.** Codes are shown grouped ("482 913", "4829 1305") from `CodeResult.formatted`, never as one run. Screen readers get the digits spaced one by one ("4 8 2 9 1 3").

Inputs are 16px on every viewport so iOS never zooms on focus.

## Layout

- **Timetable grid.** One CSS grid (`.entry-grid`) shared by the column header and every row, so columns align exactly.
  - Phone (<768px): two-line row. Issuer over account on the left; code on the right with the clock and seconds side by side under it; then a 44px row-actions button outside the copy button. Accounts such as "sam.rivera@proton.me" fit in full at 390px; longer ones wrap to a second line before they are cut with an ellipsis. A one-line "Tap a row to copy its code." hint sits under the bar while the vault has entries.
  - Tablet (768px+): columns clock 44px, issuer 12rem, account flexible, code 12.5rem, valid-for 4.5rem.
  - Desktop (1024px+): issuer 16rem, code 16rem, valid-for 5.5rem. Column header row (Issuer, Account, Code, Valid for) shows from 768px.
- **Rows:** 72px min on phones, 76px from 768px. Full-bleed on phones, inset 24px/48px from the page edge on tablet/desktop, max width 80rem.
- **Top bar:** 64px single row from 768px (wordmark 13rem column, search fills the middle, red Add entry, account menu). On phones it is two rows: wordmark + red icon Add + account menu, then a full-width search field.
- **Auth screens:** black bar with the wordmark on the same left edge as the form, then one narrow column (24rem max) on the ground; full-bleed with 16px gutters on phones, 64px top offset from `sm`.
- **Safe areas:** viewport-fit=cover; side gutters are `max(1rem, env(safe-area-inset-left/right))`, the bar pads `env(safe-area-inset-top)`, sheets pad the bottom inset.
- **Touch:** every interactive target is at least 44px (buttons, icon buttons, menu items, tabs, the Advanced disclosure, link buttons).

## Elevation & Depth

Flat. No shadows at rest or in menus. Depth is tone steps only: ground, then row/row-alt, then the white dialog surface on a 55% black scrim. Overlays do not blur.

**The Tone Step Rule.** If something needs to read as "above", give it the next tone and a 1px ring, never a shadow.

## Shapes

Square-to-4px corners. Buttons, inputs, selects, menus, popovers and alerts use 4px; the search field, notice strips and badges 2.4px; dialogs and the bottom sheet 3.2px; the strength meter segments 1px. The only circles are the clock face and its hand disc.

## Components

- **Sweep clock** (signature). A 28px SVG on phones (32px from 768px): ink ring 2.5px, four heavy quarter ticks (plus eight minor ticks from 768px), a red hand with a station-clock disc near the tip, ink centre pin. The hand angle comes from `CodeResult.elapsed`: it rests at 12 for the first 5% of the period, right after the code rotated (the station clock's beat, coinciding with the new code appearing), then sweeps one full turn and arrives back at 12 exactly when the code rotates. The hand never parks at 12 while an old code is still live. During the last 5 seconds (`expiring`) the ring turns red too, the code turns red, and the seconds label turns red and bold. Rotation is an SVG `transform` attribute (no CSS transition, no inline style), so it steps cleanly and is CSP-safe.
- **Entry row.** The whole row (except the actions button) is one native `<button>`: click, tap, Enter or Space copies the code (Clipboard API, with a textarea fallback for plain-http instances). The seconds cell, right under the finger, shows "Copied" with a check for 1.6s while the account label stays put, and a polite live region announces "Copied GitHub code". The button's accessible name is "Copy code:" plus issuer, account and the code spelled digit by digit; the live seconds are visual only so the name does not change every second. The desktop column header reads "Code · click a row to copy". The hover and focus tint covers the whole row, actions included. Rows are memoised; only the live leaf (clock, code, seconds) subscribes to the shared `useNow()` ticker.
- **Row actions.** Per-row kebab DropdownMenu (Edit, Delete). Delete confirms in an AlertDialog that names the service and says it cannot be undone from this app.
- **Top bar search.** Filters issuer and account as you type; `/` focuses it on desktop, Escape clears it, a clear button appears when it has text.
- **Notices.** Plain bordered strip for clock drift (ink 1px border), tone strip for limit and undecryptable counts, Alert for load failures. None are red.
- **Add / Edit entry.** Bottom sheet on phones, dialog from 768px. Tabs Scan, Paste link, Enter manually (Paste link is the default on desktop, Scan on phones); the selected tab is an ink fill with ground-coloured text on the tone track. Scan and Paste converge on the same review form (Service, Account, Secret, Advanced disclosure with Algorithm, Digits, Period). In edit mode the secret is masked behind "Show secret".
- **Auth forms.** Labels above fields, descriptions in grey, errors in text red linked by `aria-describedby`, a polite live region for async status, full-width primary button whose label reports progress ("Unlocking your vault...", "Creating your encryption key...").
- **Recovery key panel** (shared by registration step 2, the recover page and Account menu > Recovery key). The 20-character key in four monospace groups on a card, select-all, with Download .txt (primary) and Copy. Wherever a new key is issued a required "I saved my recovery key" checkbox gates the continue button, next to a plain warning (the key replaces the old one; it restores account access only and erases saved entries when used).
- **Account menu.** Recovery key, Change password, Export, Import, then Lock (with a one-line grey note about automatic locking after 10 min idle or 5 min in the background) and Sign out. Every item opens a bottom sheet on phones and a dialog from 768px.
- **Locked screen.** Same narrow auth column with password only and a Sign out link. When the vault locked itself, a tone strip says "Locked after a period of inactivity." once; it clears on unlock.
- **Closed registration.** Two calm states: "Registration is closed on this instance", or, when the server has no setup token, a plain instruction naming the SETUP_TOKEN environment variable (set it, restart) with a way back to sign in.
- **Empty, no-match, loading.** Empty vault: one heading, one line about Scan or Paste, one red "Add your first entry" button. No match: names the query and offers Clear search. Loading: skeleton rows in the same grid.

Motion: one moving thing, the clock hand, which follows the library ticker (100ms, 1s under reduced motion). Everything else is instant or uses the primitives' short fades; `prefers-reduced-motion` collapses all animations and transitions.

Browser surfaces: themed `::selection` (ink on ground, inverted in the bar), caret in ink, 2px ink focus outline with 2px offset, thin scrollbars in the control-edge tone, `color-scheme` per mode, theme-color meta black (#111111 light, #000000 dark), an SVG station-clock favicon and a standalone web manifest.

## Do's and Don'ts

- Do keep the code the largest, boldest element in any view that shows one.
- Do print seconds remaining as text next to every clock.
- Do use tabular figures for anything numeric that updates or aligns.
- Do keep 44px minimum targets and 16px input text.
- Don't use red for anything except the primary action, the expiring state and the clock hand (plus text-red for errors).
- Don't add shadows, blur, gradients, rounded cards or nested containers. Rows are the container.
- Don't add a second moving element or animate the hand with CSS transitions.
- Don't use inline `style` attributes or `<style>` tags; the CSP blocks them. Use classes and SVG presentation attributes.
- Don't add eyebrows or marketing copy. Headings say what the screen is for; errors say what happened and what to do.
