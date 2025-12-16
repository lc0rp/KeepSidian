# Source Tree

This document maps the repository structure to the runtime responsibilities of the plugin.

## Root

- `manifest.json`: Obsidian plugin metadata (id, name, min app version, version).
- `main.js`: built plugin bundle shipped to Obsidian.
- `styles.css`: plugin styles (status UI, modals, settings).
- `package.json`: dev scripts, linting, tests, build pipeline.
- `esbuild.config.mjs`: build entry (injects environment variables like `KEEPSIDIAN_SERVER_URL`).

## `src/`

- `src/main.ts`: Obsidian entrypoint; re-exports `src/app/main.ts`.
- `src/app/`: plugin runtime glue (commands, status UI, logging utilities).
  - `src/app/main.ts`: `KeepSidianPlugin` class (settings, sync commands, auto-sync, gating).
  - `src/app/commands.ts`: ribbon + command registration.
  - `src/app/sync-ui.ts`: status bar + progress modal orchestration.
  - `src/app/logging.ts`: sync log writer (`_KeepSidianLogs/`).
- `src/features/keep/`: Keep-domain workflows (download, upload, note normalization, attachments).
  - `src/features/keep/sync.ts`: download orchestration (pagination, de-dupe, merge, persistence).
  - `src/features/keep/push.ts`: upload orchestration (eligible note detection, attachment bundling, API push).
  - `src/features/keep/domain/`: note normalization + duplicate/merge logic.
  - `src/features/keep/io/`: attachment IO helpers.
- `src/integrations/`: external boundaries (server API, token/OAuth helpers).
  - `src/integrations/server/keepApi.ts`: server contract (fetch + push).
- `src/services/`: cross-cutting utilities (HTTP wrapper, paths, errors, subscription).
- `src/ui/`: settings UI and modals.
- `src/schemas/`: runtime validation of server payloads (Zod).
- `src/types/`: settings and domain types.

## Path aliases

TypeScript uses aliases such as `@app/*`, `@features/*`, `@integrations/*`, `@services/*`, `@types/*`, `@schemas/*`.
