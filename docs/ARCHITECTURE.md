# VAULT — Architecture

Phase 1 deliverable. This document is the reference for every later phase;
changes to it are recorded in [DEVLOG.md](../DEVLOG.md).

## 1. What VAULT is

A single-user Windows desktop application that turns manually recorded income
and expenses into answers: what is safe to spend, where money goes, when a
purchase becomes affordable, and what the next 3–24 months look like.

It is not a bank client. It never connects to a bank, so every figure is
derived from what the user records. That one fact shapes the data model
(section 4) and is why balance reconciliation exists.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Small installer (~10 MB vs ~100 MB for Electron), Rust backend, webview has no ambient filesystem/network access. |
| UI | React 19, TypeScript, Vite | As requested; strict TypeScript throughout. |
| Financial engine | Pure TypeScript (`src/engine`) | See 3.1. |
| Storage | SQLite + SQLCipher, via `rusqlite` in Rust | Whole-database encryption at rest. See 5. |
| Server state | TanStack Query over Tauri commands | Caching and invalidation without a hand-rolled store. |
| Charts | SVG built on `d3-scale`/`d3-shape` | Full control over the visual language; no template-looking chart library defaults. Decided finally in Phase 2. |
| Tests | Vitest (engine), `cargo test` (storage, crypto) | |
| AI (optional) | Ollama on localhost by default; cloud provider opt-in | See 6. |

## 3. Structure

```
src/
  engine/        Pure financial logic. No React, no Tauri, no I/O, no clock
                 (except dates.today). 100% unit-tested.
  data/          Typed wrappers around Tauri commands + query hooks.      (Phase 3)
  features/      One folder per module: dashboard, transactions,
                 simulator, goals, affordability, forecast, assistant.    (Phase 2+)
  ui/            Design system: tokens, primitives, charts.               (Phase 2)
  app/           Shell, navigation, lock screen.                          (Phase 2)
src-tauri/src/
  db/            Connection, migrations, repositories.                    (Phase 3)
  vault/         Key derivation, lock/unlock, backup/restore, wipe.       (Phase 3)
  commands/      The only surface the webview can call.                   (Phase 3)
  ai/            Provider gateway, audit log.                             (Phase 5)
docs/            Architecture and decisions.
```

### 3.1 The engine lives in TypeScript, not Rust

The brief suggests Rust "where appropriate". For calculations it is not:

- The simulators recalculate on every slider movement. In-process TypeScript is
  instant; an IPC round-trip per frame is not.
- One implementation means the dashboard, the simulators and the AI assistant
  cannot disagree about a number.
- The volumes are tiny (thousands of rows, tens of projected months).

Rust owns what must not be reachable from web content: disk, encryption keys,
network. The boundary is: **Rust stores and protects, TypeScript computes,
React displays.**

### 3.2 Money and dates

- Money is an integer count of centimes, in SQLite (`INTEGER`) and in
  TypeScript (branded `Centimes`). No float ever holds an amount.
- Rates are integer basis points. Scaling goes through one BigInt function
  (`mulRatio`), rounding half away from zero.
- Undefined ratios (savings rate with zero income) are `null` and rendered as
  "—", never as 0% or ∞.
- Dates are calendar strings (`YYYY-MM-DD`), not timestamps: no timezone or DST
  can move a transaction to another day.
- Recurrences are computed from the rule's start date, so month-end schedules
  do not drift.

## 4. Data model

Design points that go beyond the brief:

- **Accounts.** "Available balance" and "total savings" are different things,
  and moving money between them is neither income nor an expense. So there are
  accounts (current, savings, cash) and a `transfer` transaction kind. Without
  this, every transfer to savings would wrongly count as spending.
- **Balance checkpoints.** A computed balance drifts from the real one whenever
  a transaction is forgotten. The user can record "my real balance today is X";
  VAULT shows the gap instead of hiding it.
- **Recurring rules are templates.** When an occurrence's date arrives it is
  posted as a real, editable transaction (idempotent via a unique key). Future
  occurrences are never stored; forecasts compute them.

```sql
accounts(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('current','savings','cash')),
  opening_balance INTEGER NOT NULL,            -- centimes
  opening_date TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)

categories(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('income','expense')),
  is_fixed_default INTEGER NOT NULL DEFAULT 0, -- rent/bills/subscriptions
  archived INTEGER NOT NULL DEFAULT 0)

transactions(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts,
  date TEXT NOT NULL,                          -- YYYY-MM-DD
  kind TEXT CHECK (kind IN ('income','expense','transfer')),
  amount INTEGER NOT NULL CHECK (amount > 0),  -- centimes; kind gives direction
  category_id TEXT REFERENCES categories,      -- null for transfers
  transfer_account_id TEXT REFERENCES accounts,
  description TEXT, notes TEXT,
  is_fixed INTEGER NOT NULL DEFAULT 0,
  recurring_rule_id TEXT REFERENCES recurring_rules,
  occurrence_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (recurring_rule_id, occurrence_date))

recurring_rules(
  id TEXT PRIMARY KEY,
  account_id, kind, amount, category_id, transfer_account_id, description,
  frequency TEXT CHECK (frequency IN ('weekly','monthly','yearly')),
  interval INTEGER NOT NULL CHECK (interval >= 1),
  start_date TEXT NOT NULL, end_date TEXT, paused INTEGER NOT NULL DEFAULT 0)

recurring_exceptions(rule_id, occurrence_date, PRIMARY KEY (rule_id, occurrence_date))

balance_checkpoints(id TEXT PRIMARY KEY, account_id, date TEXT, balance INTEGER)

goals(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  target_price INTEGER NOT NULL, additional_costs INTEGER NOT NULL DEFAULT 0,
  saved_amount INTEGER NOT NULL DEFAULT 0,
  target_date TEXT, monthly_contribution INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL, status TEXT CHECK (status IN ('active','achieved','archived')))

goal_ownership_costs(                          -- insurance, fuel, maintenance, registration
  id TEXT PRIMARY KEY, goal_id TEXT REFERENCES goals ON DELETE CASCADE,
  label TEXT NOT NULL, amount INTEGER NOT NULL,
  frequency TEXT CHECK (frequency IN ('once','monthly','yearly')))

scenarios(id TEXT PRIMARY KEY, name TEXT, params TEXT)  -- saved simulator inputs (JSON)
settings(key TEXT PRIMARY KEY, value TEXT)
ai_audit_log(id, at, provider, destination, tools_called, bytes_sent)
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)
```

Indexes on `transactions(date)`, `(account_id, date)`, `(category_id, date)`.
Migrations are numbered SQL files applied in a transaction at unlock.

**Demo mode** uses a separate database file. Sample data can never mix with
real records, and a permanent "DEMO DATA" banner is shown while it is open.

## 5. Security model

**Threats addressed:** someone with access to the PC or a copy of its disk;
other software reading the data file; a compromised dependency in the webview
trying to exfiltrate data; accidental disclosure to an AI provider.
**Not addressed:** malware running as the user while VAULT is unlocked — no
desktop application can defend against that.

| Control | Design |
|---|---|
| Encryption at rest | SQLCipher (AES-256, per-page HMAC). The whole file is opaque, including the schema. |
| Key | Argon2id (64 MiB, 3 passes) over the passphrase with a random salt stored beside the DB. The key lives only in Rust memory, zeroised on lock. Never written to disk. |
| Application lock | The lock *is* the key: locking closes the DB and drops the key. Auto-lock on idle and on Windows session lock. Attempts are rate-limited. |
| No recovery | A forgotten passphrase means the data is unrecoverable. This is stated at setup. A recovery backdoor would be a hole in the vault. |
| Webview isolation | Strict CSP (`default-src 'self'`, `connect-src ipc:` only). Capabilities grant core IPC only: no fs, shell, http or opener plugins. Fonts and assets are bundled; nothing loads from the internet. |
| Narrow command surface | The webview calls typed commands (`list_transactions`, …). It cannot send SQL. `tauri-plugin-sql` is deliberately not used. |
| Network | Zero network code in the default build path. No telemetry, no analytics, no update pings. The only component able to make a request is the AI gateway, and only once enabled. |
| Secrets | A cloud AI key is stored in Windows Credential Manager and read only by Rust. It never enters the webview or the bundle. |
| Backup | Encrypted backup = a SQLCipher copy (`VACUUM INTO`) under its own passphrase. Restore verifies integrity before replacing anything and keeps the previous database until success. |
| Export / deletion | Plain CSV/JSON export behind an explicit "this file is not encrypted" confirmation. "Delete everything" removes the database, salt, settings and stored AI key. |

## 6. AI assistant

The language model never does arithmetic and never sees the raw database.

1. The model receives the question and a list of **tools**, each one a thin
   wrapper over an engine function (`monthly_summary`, `compare_categories`,
   `project_savings`, `goal_plan`, …).
2. It requests tool calls; VAULT executes them locally and returns results.
3. The answer is displayed with the tool calls behind it ("how this was
   calculated"), so every figure is traceable to engine output. Numbers in the
   answer that match no tool result are flagged.

- **Off by default.** Every feature except the chat works without it; insights
  on the dashboard are deterministic engine output, not AI.
- **Local first:** Ollama on `127.0.0.1`. Nothing leaves the machine.
- **Cloud is opt-in**, with a disclosure of what is sent (the question and the
  aggregated results of the tools invoked — not the transaction table), and an
  audit log of every outbound request.
- Framed as explanation and suggestion, never certified financial advice.

## 7. Transparency rules for intelligence features

- **Scenarios** (conservative / normal / aggressive) are named presets of
  visible, editable parameters (income change, expense change, contribution).
  No hidden model.
- **Affordability** verdicts (comfortable / caution / risky) come from explicit
  thresholds — months of expenses left as a buffer, share of savings consumed,
  impact on active goals, installment burden vs. disposable income. Thresholds
  are shown next to the verdict and adjustable in settings.
- **Every insight** carries its inputs and formula.
- Insufficient data is reported as such ("needs 2 full months of records"),
  never papered over with an estimate.

## 8. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 Architecture | This document, scaffold, engine primitives | Tests green; app compiles. |
| 2 Design | Tokens, typography, shell, navigation, lock screen, dashboard layout, chart primitives | Dashboard renders from engine output on demo DB; reviewed in the running app. |
| 3 Financial core | SQLCipher storage, migrations, lock/unlock, accounts, transactions CRUD, categories, recurring posting, search/filter/sort, CSV import/export, budget ("safe to spend") | Round-trip tests in Rust; engine tests for budget; data survives restart; wrong passphrase rejected. |
| 4 Intelligence | Projection engine, savings simulator, goals with ownership costs, goal comparison, affordability calculator, forecast with warnings, insights | Each calculation unit-tested against hand-worked examples. |
| 5 AI | Tool layer, Ollama provider, cloud provider + disclosure + audit log | Assistant answers match engine output in tests; app fully usable with AI off and network disabled. |
| 6 Security & delivery | Audit against section 5, offline test, backup/restore test, NSIS installer | Checklist signed off in DEVLOG; installer runs on a clean Windows profile. |

## 9. Technical risks

| Risk | Mitigation |
|---|---|
| **SQLCipher build on Windows.** Bundled SQLCipher compiles OpenSSL, which needs a native Windows Perl (Strawberry Perl). This machine only has Git's MSYS Perl. | First task of Phase 3 is a build spike. If the toolchain proves too fragile, fallback is an in-memory SQLite database serialised and sealed with XChaCha20-Poly1305 (pure-Rust crypto, no OpenSSL), written atomically. Weaker durability, same confidentiality. |
| Recorded balance drifts from the real one | Balance checkpoints and a visible reconciliation gap. |
| Forgotten passphrase = total loss | Clear warning at setup; encrypted backups can use a different, written-down passphrase. |
| Projections read as promises | Always labelled as arithmetic on stated assumptions; assumptions displayed with each chart. |
| Local LLM quality on modest hardware | Tool-calling keeps the model's job small (choose tools, phrase results); cloud provider is available as an explicit opt-in. |
| Ambiguous amount entry ("1.500") | One documented parsing rule; inputs echo the parsed value before saving. |
| Unsigned installer triggers SmartScreen | Acceptable for personal use; code signing is out of scope unless requested. |
