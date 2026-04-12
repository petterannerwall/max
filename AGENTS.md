> **Note:** These instructions only apply when Max is running in self-edit mode (`--self-edit` flag). This container always starts with self-edit enabled via `start-max.sh`.

Your own source code is a live, editable checkout at `/workspace/max`.

## Build Commands

| Command | What it does |
|---------|--------------|
| `npm run build` | Compile TypeScript → `dist/` — runs automatically on every container restart |
| `npm run dev` | Watch-mode daemon (tsx --watch) |
| `npm run tui` | Start the terminal UI client |

No test or lint scripts. After editing, use `restart_max` — don't build manually.

## Source Layout

```
/workspace/max/
  src/
    cli.ts              - Entry point, parses commands and flags
    daemon.ts           - Startup sequence, wires everything together
    config.ts           - Reads env vars (TELEGRAM_BOT_TOKEN, COPILOT_MODEL, etc.)
    paths.ts            - All ~/.max/* path constants
    setup.ts            - Interactive first-run configuration wizard
    update.ts           - Self-update logic
    copilot/
      orchestrator.ts   - Persistent session, message queue, retry logic
      system-message.ts - Builds the orchestrator system prompt
      tools.ts          - All tool definitions (create_worker_session, remember, etc.)
      router.ts         - Auto model routing (fast/standard/premium tiers)
      client.ts         - CopilotClient singleton
      skills.ts         - Skill directory resolution
      mcp-config.ts     - MCP server config loader
      memory-extractor.ts
    store/
      db.ts             - SQLite schema, conversation log, wiki-backed memory
    wiki/
      context.ts        - Wiki summary and relevance retrieval
    telegram/           - Telegram bot integration
    api/                - HTTP API (port 7777) for TUI
    tui/                - Terminal UI client
  dist/                 - Compiled JS output — never edit directly
  package.json
  tsconfig.json
```

## Self-Edit Workflow

**Before touching any source file, tell the user exactly what you plan to change and wait for their approval.** Do not proceed until they confirm. If you break Max, you cannot repair yourself.

When the user confirms a change:
1. Create a worker session with `working_dir` set to `/workspace/max`.
2. Edit files in `/workspace/max/src/` only — **never touch `/workspace/max/dist/`** (generated output, overwritten on every build).
3. Use `restart_max` to apply — Docker restarts the container and runs `npm run build` automatically.

## Coding Conventions

- **ESM only** — imports use `.js` extensions even for `.ts` source files (e.g. `import { x } from "./foo.js"`)
- **Named exports only** — no default exports anywhere
- **No classes** except `Database` in `store/db.ts` — everything else is plain functions + types
- **Zod for validation** at system boundaries (config.ts, tool inputs)
- **Fewest lines that remain readable** — no extra ceremony

## Configuration (Environment Variables)

| Var | Default | Notes |
|-----|---------|-------|
| `TELEGRAM_BOT_TOKEN` | — | Optional; bot disabled if absent |
| `AUTHORIZED_USER_ID` | — | Required when bot is enabled |
| `API_PORT` | `7777` | HTTP API for TUI |
| `COPILOT_MODEL` | `claude-sonnet-4.6` | Persisted to `~/.max/.env` on `/model` switch |
| `WORKER_TIMEOUT` | `600000` (10 min) | Max ms a worker may run |
| `MAX_SELF_EDIT` | `0` | Set to `1` by `--self-edit` flag |
| `MAX_SOURCE_DIR` | — | Always `/workspace/max` in container |

## Architecture

- **Orchestrator** (`copilot/orchestrator.ts`) — single shared `CopilotSession`; serialised message queue with 3-retry exponential backoff; health-check every 30 s
- **Workers** (`copilot/tools.ts`) — max 5 concurrent; isolated per `working_dir`; blocked dirs include `.ssh`, `.aws`, `.kube`; timeout errors surface retry hints
- **Router** (`copilot/router.ts`) — classifies prompts into fast/standard/premium tiers; design tasks → Claude Opus; disabled by default
- **Skills** (`copilot/skills.ts`) — three-tier discovery: bundled → `~/.max/skills/` → `~/.agents/skills/`; each skill is a directory with `_meta.json` + `SKILL.md`
- **DB** (`store/db.ts`) — SQLite with WAL; FTS5 full-text search on memories; conversation log pruned to 1000 rows; wiki migration runs at startup
- **MCP** (`copilot/mcp-config.ts`) — reads `~/.copilot/mcp-config.json`; returns `{}` silently if missing

## Container Notes

- `node_modules` lives on a separate Docker volume (`max-node-modules`) — NOT on the bind-mounted source volume. Don't reinstall dependencies unless `package.json` changed.
- User data (wiki, memories, sessions) is on `max-data` at `~/.max/`. GitHub auth is on `gh-auth` at `~/.config/gh/`.
- Container user is `maxuser` (uid 1001).

## Critical Rules — Things That Will Break Max

**You are single-threaded.** `processQueue()` processes one orchestrator turn at a time. While a turn is in flight, every incoming message queues up and waits. Each turn has a hard 300-second timeout.

**Workers are fire-and-forget — they never block.** `create_worker_session` and `send_to_worker` dispatch asynchronously and return immediately. When a worker finishes, `feedBackgroundResult()` enqueues a new orchestrator turn — it never interrupts the one running. Workers auto-destroy on completion and cannot be reused.

**Never await the orchestrator from an HTTP handler.** `sendToOrchestrator()` is fire-and-forget — it returns nothing. If you add an endpoint that blocks until the orchestrator responds, it hangs for up to 300 seconds, holds the event loop, kills SSE heartbeats, and freezes all API requests. Max will appear dead. New endpoints must return an immediate HTTP response and deliver results over the SSE stream at `/stream`.

**Tool handlers must return quickly.** They run inside the orchestrator's active turn — blocking one blocks everything. Delegate long-running work to a worker session.

**Always verify the build before calling `restart_max`.** Run `npm run build` in the worker and confirm it exits clean. If compilation fails, `start-max.sh` exits, Docker restarts, the same broken build runs again — infinite loop. Max cannot recover on his own.

**Don't write invalid values to `~/.max/.env`.** `config.ts` throws at module load — no catch — if `AUTHORIZED_USER_ID` is not a positive integer, `API_PORT` is outside 1–65535, or `WORKER_TIMEOUT` is not a positive integer. Every restart will fail until fixed manually.

**Don't corrupt `~/.max/max.db`.** The database opens without error handling. A corrupt or locked file crashes startup on every restart. Manual deletion is the only recovery.

**Port conflicts cause a restart loop.** If port 7777 is taken, `startApiServer()` throws inside `main()`, exits with code 1, and Docker restarts into the same conflict.

**The Telegram bot silently fails on invalid tokens.** `startBot()` catches and logs 401 errors but does not rethrow. The daemon starts fine but Max never receives Telegram messages.

**The Copilot client has no startup timeout.** If Copilot auth is unreachable, `getClient()` hangs indefinitely — the process is alive but processes nothing.
