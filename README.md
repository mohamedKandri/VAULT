# VAULT

Private, local-first personal financial intelligence for Windows.
Single user, MAD by default, no cloud, no telemetry.

**Status:** All six roadmap phases have a working implementation. See the dev log for what was verified and what was not (notably: the optional local AI model has only been tested against a simulated server).

- Architecture, data model and security: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Progress and decisions: [DEVLOG.md](DEVLOG.md)

## Develop

Requires Node 20+, pnpm 9+, Rust stable and the Tauri 2 Windows prerequisites.

```bash
pnpm install
pnpm test          # financial engine unit tests
pnpm tauri dev     # run the desktop app
pnpm tauri build   # release build + Windows installer (src-tauri/target/release/bundle/nsis)
```
