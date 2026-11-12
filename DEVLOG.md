# VAULT — Development log

Newest entry first. Each entry records what was done, what was verified,
decisions taken and what remains.

## 2026-11-12 — Phases 3 (completion), 4, 5 and 6

### Phase 4 — Intelligence (done)
- Engine: `projection.ts` (savings projection, three visible scenarios),
  `goals.ts` (price + one-off costs + ownership costs, required monthly
  saving, on-track), `affordability.ts` (explicit thresholds, verdict with
  reasons), `forecast.ts` (month-end balances from schedules, a stated
  variable-spending figure and planned purchases, with warnings).
- Storage: goals and their cost lines (migration 3).
- Screens: Savings Simulator (sliders, 3/6/12/24/custom months, target line,
  scenario table), Purchase Goals (cards, side-by-side comparison),
  Affordability (verdict, reasons, the rules shown), Forecast (with / without
  planned purchases). Dashboard goals panel.

### Phase 3 — completion (done)
- CSV export (with spreadsheet-formula guard) and import with a preview:
  rows to add, duplicates skipped, unreadable lines with reasons, new
  categories. Import is all-or-nothing.
- Encrypted backup, restore (verified in memory first; previous vault kept),
  full JSON export behind an "unencrypted" warning, delete-everything behind
  the passphrase and a typed confirmation.
- Balance reconciliation: compare with the real balance, record the gap.
- File dialogs are opened by Rust; the webview never handles a path.
- Health indicators now key off account opening dates (fixes the known issue).

### Phase 5 — Assistant (done, with one limit)
- Nine tools over the engine; the only source of figures in any answer.
- Built-in answers: common questions recognised and answered with no AI.
- Any number in an answer that appears in no tool result is flagged.
- Optional local model through Ollama: off by default, loopback address
  fixed in Rust, disclosure in the interface, request audit log (migration 4).
- **Limit:** Ollama is not installed on this machine. The model path is
  tested against a simulated server (request shape, tool-call parsing, error
  messages) and with a scripted model in the tool loop. It has never run
  against a real model. A cloud provider was not built.

### Phase 6 — Security review and delivery
Reviewed against ARCHITECTURE section 5:

| Control | State |
|---|---|
| Encryption at rest, no plaintext on disk | Done, tested (Rust + real window) |
| Lock = key dropped; auto-lock on idle | Done. **Not done:** lock on Windows session lock |
| Wrong passphrase / tampering refused | Done, tested |
| Webview isolation: CSP, core-only capabilities | Done. No fs, shell, http or dialog plugin |
| Typed commands only, no SQL from the webview | Done (29 commands) |
| Network | None, except the opt-in loopback model gateway |
| Telemetry, analytics, update checks | None exist |
| Backup / restore / export / delete | Done, tested |
| Secrets in the frontend | None. No API keys exist anywhere |
| Decrypted pages wiped from memory | **Not done** (SQLite frees them unwiped) |

Residual risks, accepted: software running as the same Windows user while
VAULT is unlocked can read its memory, and WebView2 honours its debugging
environment variable; the passphrase passes through the webview once on entry.
The installer is unsigned, so SmartScreen will warn. App icons are still the
Tauri defaults.

### Verified
- `cargo test` 40, `pnpm test` 187; typecheck, build clean.
- In the real Tauri window (throwaway data folder): goal creation with cost
  lines, dashboard goal, affordability, forecast; batch import and its
  all-or-nothing rule; reconciliation (gap of MAD 1,000.50 recorded, balance
  then MAD 14,000.00); delete-everything refused with a wrong passphrase and,
  with the right one, leaving an empty folder and the setup screen.
- Not driven end to end: the native file dialogs (export, import picker,
  backup, restore). Their logic is covered by Rust tests.
- Release build: `pnpm tauri build` succeeded and produced
  `src-tauri/target/release/bundle/nsis/VAULT_0.1.0_x64-setup.exe` (about 3 MB).
  The packaged executable was started once, read-only: it showed the lock
  screen, rendered nothing of the app while locked, refused data and AI
  commands with `locked`, loaded the bundled font, and ignored the
  development-only `VAULT_DATA_DIR` setting.
- **Not verified:** running the installer itself, or installing on a clean
  Windows profile.

## 2026-11-12 — Phase 3 (part 2): recurring items, spending limit, health

### Done
- Recurring income, expenses and transfers: rules stored in Rust, occurrence
  dates computed by the engine, posted automatically when the ledger loads.
  Each occurrence posts at most once; one the user deletes is not recreated;
  pausing skips occurrences without backfilling on resume.
- Safe-to-spend (`engine/budget.ts`): expected income minus fixed and
  scheduled expenses minus savings transfers, minus variable spending so far.
  The dashboard panel lists every line of the calculation on demand.
- Health indicators from the last one to three complete months: expense
  cover, fixed-cost share, savings rate. Null until a full month exists.
- Transactions screen gained a History / Recurring switch.

### Verified
- `cargo test` 26, `pnpm test` 131, typecheck and build clean.
- In the real Tauri window: after a full application restart the vault was
  locked and the earlier records were intact; a monthly rent rule starting
  2 Sep posted exactly three fixed expenses (Sep, Oct, Nov) and showed 2 Dec
  as upcoming; the spending-limit panel showed MAD 6,200.00
  (14,000 income - 3,800 rent - 4,000 moved to savings), matching by hand.

### Known issue
- Health indicators count a month as "complete" if any transaction predates
  it, even one dated before the accounts' opening date (possible through a
  backfilled recurring rule). Should key off account opening dates.

### Not done (rest of Phase 3)
- CSV import and export; balance checkpoints; backup / restore; full export;
  delete-everything; auto-lock on Windows session lock; goals panel (Phase 4).

### Next
- Finish the Phase 3 items above, then Phase 4: projection engine, savings
  simulator, purchase goals with ownership costs, affordability, forecast.

## 2026-11-12 — Phase 3 (part 1): encrypted storage, lock, accounts, transactions

### Done
- SQLCipher build spike: **failed** as anticipated (OpenSSL's build needs a
  native Windows Perl; only Git's MSYS Perl is installed). Adopted the
  documented fallback, in pure Rust.
- `crypto.rs` — Argon2id (64 MiB, 3 passes) key derivation; XChaCha20-Poly1305
  sealing with a fresh nonce per write; header bound as associated data;
  hostile KDF parameters in a file header are rejected.
- `vault.rs` — the SQLite database exists only in memory. One sealed file on
  disk, replaced atomically (write temp, fsync, rename) after every committed
  change. Create, unlock, lock, change passphrase. Failed unlocks are slowed
  down. Failed changes roll back.
- `db.rs` — migration 1 (accounts, categories, recurring_rules, transactions,
  settings, seeded categories), strict validation, table-level CHECK
  constraints, refusal to open a vault from a newer schema.
- `commands.rs` — 13 typed commands; the webview cannot send SQL.
- Interface: lock / create-vault screen (nothing of the app renders while
  locked), auto-lock after 10 minutes idle, Transactions screen (add, edit,
  delete, month navigation, type / account / category filters, search,
  sorting, totals), Settings (accounts with live balances, custom categories,
  archive, change passphrase, lock now). Dashboard now reads real records.
- Amount inputs echo the parsed value ("Read as MAD 5,000.50").
- Development builds honour `VAULT_DATA_DIR` so testing never touches the
  real vault (ignored in release builds).

### Verified
- `cargo test`: 24 tests (round trip, wrong passphrase, tampering at four
  positions, no plaintext on disk, rollback, passphrase change, validation).
- `pnpm test`: 117 tests (5 new for transaction filtering). Typecheck, build,
  clippy clean.
- **End to end in the real Tauri window** (driven through WebView2's debug
  port against a throwaway data folder): created a vault through the form,
  added two accounts, recorded an expense, an income and a transfer, searched,
  edited, deleted; dashboard showed MAD 14,680.00 available and MAD 24,000.00
  savings, matching hand calculation. Locking removed the app from the page;
  reads and writes returned `locked`; a wrong passphrase was refused; the
  right one restored all records. The data folder held exactly one file,
  starting `VAULTDB1`, with no readable text. Backend rejected a negative
  amount, a fractional amount, an impossible date and a mismatched category
  when the form was bypassed.

### Decisions
- Sealed-file storage instead of SQLCipher (ARCHITECTURE 5 and 9). Trade-offs
  recorded there: whole-file rewrite per change, and freed pages are not wiped
  from process memory.
- Whole ledger is loaded into the interface on unlock and after each change;
  the engine computes everything in TypeScript. Simple and fast at this size.
- Accounts with transactions can be archived but not deleted.

### Not done / open (rest of Phase 3)
- Recurring transactions: table exists, but no posting, no UI.
- CSV import and export.
- Safe-to-spend budget; the dashboard's spending-limit panel is still a
  placeholder. Goals panel waits for Phase 4.
- Balance checkpoints (reconciliation), backup / restore, full export,
  delete-everything.
- Auto-lock on Windows session lock (only idle timeout exists).
- Not verified: a full application restart between create and unlock in the
  real window (covered by a Rust test with a fresh `Vault` value), and the
  packaged release build.
- PR 1 (Phase 2) is still open; this branch is stacked on it.

## 2026-11-12 — Phase 2: design, shell and Command Center

### Done
- Visual identity: design tokens (`src/ui/tokens.css`) — graphite/near-black
  surfaces, one neutral ink scale, green reserved for "positive", amber/red for
  attention. Inter Variable bundled locally (no remote fonts).
- Application shell: grouped sidebar navigation, hash routing, top bar,
  collapse to an icon rail under 1080px and a bottom bar under 640px.
- Command Center built entirely from engine output: available balance (hero),
  split of net worth, income / expenses / savings rate / total savings tiles
  with 12-month sparklines, income vs expenses, monthly cash flow, savings
  evolution, spending distribution with fixed vs variable, upcoming scheduled
  items.
- Chart primitives in hand-written SVG (`src/ui/charts/MonthChart.tsx`):
  columns, signed columns and lines; hover and keyboard tooltips; hidden data
  table for screen readers; current month drawn lighter and labelled "to date".
- Engine additions: accounts, transfers, `balances.ts` (account balance,
  position), `schedule.ts` (upcoming occurrences). Summaries ignore transfers.
- Demo mode: deterministic in-memory sample ledger, permanently labelled
  "Demo data", never mixed with real records. Without it the dashboard shows
  an honest "No records yet" state.
- Unbuilt modules have "Not built yet" pages naming their roadmap phase.

### Verified
- `pnpm test`: 112 tests passing across 6 files (23 new: balances, schedules,
  dashboard model, demo ledger invariants).
- `pnpm typecheck` and `pnpm build`: clean.
- Reviewed in a browser against the dev server at 1440, 800 and 375 px wide:
  empty state, demo dashboard, chart tooltip, navigation, no console errors on
  a clean load, no horizontal overflow.
- Chart colour pair validated for colour-blind separation on the panel surface.

### Decisions
- No chart library and no d3: the scale/tick maths is small and the visual
  control is total.
- Deltas on month-to-date figures compare with the same days of the previous
  month, not the full month, so a partial month is never judged against a
  complete one.
- Unknown values render as "—", never 0 (balance before an account opens,
  savings rate with no income).
- Lock screen moved from Phase 2 to Phase 3: without encryption behind it, it
  would be decoration.
- Colour is by role, not entity: green marks the accumulating series (income,
  savings), blue the other (expenses, available). Each chart has its own legend.

### Not done / open
- Goals, spending limit and financial-health panels are placeholders: their
  calculations belong to Phases 3 and 4.
- Not yet run inside the actual Tauri window (`pnpm tauri dev`); reviewed in a
  browser only. Rust side unchanged since Phase 1.
- A Vite hot-reload error ("useLedger must be used inside LedgerProvider")
  can appear while editing during development; it does not occur on a clean
  load. Cause: context and provider share a file. Cosmetic, dev-only.

### Next (Phase 3)
- SQLCipher build spike, encrypted storage, lock/unlock, accounts and
  transactions CRUD, categories, recurring posting, CSV import/export,
  safe-to-spend budget.

## 2026-11-12 — Phase 1: architecture and foundation

### Done
- Architecture, data model, security model, roadmap and risk register:
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Tauri 2 + React 19 + TypeScript + Vite scaffold, hardened from the template:
  strict CSP, capabilities reduced to core IPC, opener plugin removed,
  NSIS-only bundle target, data files and secrets git-ignored.
- Financial engine primitives in `src/engine` (pure TypeScript):
  - `money.ts` — integer centimes, basis-point rates, BigInt ratio scaling,
    exact allocation, strict amount parsing, MAD formatting.
  - `dates.ts` — calendar-date and month arithmetic without timezones.
  - `recurrence.ts` — weekly / monthly / yearly rules, drift-free expansion.
  - `summary.ts` — monthly summary, fixed vs variable, savings rate,
    category comparison, average monthly expenses.

### Verified
- `pnpm test`: 89 tests passing across 4 files.
- `pnpm typecheck` and `pnpm build`: clean.
- `cargo check` (Rust/Tauri backend): compiles cleanly.

### Decisions
- Calculation engine in TypeScript; Rust limited to storage, crypto and
  network (ARCHITECTURE 3.1).
- Accounts + transfer transactions + balance checkpoints added to the model:
  required for "available balance" and "total savings" to be meaningful.
- Webview gets typed commands only; no SQL plugin.
- AI uses tool-calling over engine functions; the model does no arithmetic.
- Amount parsing: a lone separator followed by exactly three digits is a
  thousands separator ("1.500" = MAD 1,500); "0.500" is rejected. Found by a
  failing test during this phase.

### Not done / open
- No UI beyond a placeholder screen. No storage, no encryption, no lock yet.
- SQLCipher Windows build is unproven on this machine (needs Strawberry Perl);
  spike scheduled as the first task of Phase 3.
- The desktop window has not been launched and inspected yet.

### Next (Phase 2)
- Design tokens and typography, application shell, navigation, lock screen
  layout, dashboard layout and chart primitives.
