# VAULT

Private, local-first personal financial intelligence for Windows.
Single user, MAD by default, no cloud, no telemetry.

**Status:** Phase 3 of 6, part 1 — encrypted vault, accounts and transactions work. Recurring items, CSV, budget and backup are still to come.

- Architecture, data model and security: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Progress and decisions: [DEVLOG.md](DEVLOG.md)

## Develop

Requires Node 20+, pnpm 9+, Rust stable and the Tauri 2 Windows prerequisites.

```bash
pnpm install
pnpm test          # financial engine unit tests
pnpm tauri dev     # run the desktop app
```
