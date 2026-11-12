# VAULT — Development log

Newest entry first. Each entry records what was done, what was verified,
decisions taken and what remains.

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
