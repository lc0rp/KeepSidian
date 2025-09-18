# Architecture Overview

This project is an Obsidian plugin that syncs Google Keep notes into an Obsidian vault. The codebase is organized by layers with clear responsibilities and minimal coupling.

## Layers

- App (src/app)
  - Entry + orchestration. Minimal UI glue and lifecycle.
  - Files: `main.ts`, `commands.ts`, `sync-ui.ts`, `logging.ts`.
- UI (src/ui)
  - View components: settings tabs and modals.
  - Files: `ui/settings/*`, `ui/modals/*`.
- Features (src/features)
  - Domain-specific logic for Keep: normalization, duplicate handling, merges, sync orchestration, attachments IO.
  - Files: `features/keep/domain/*`, `features/keep/sync.ts`, `features/keep/io/attachments.ts`.
- Integrations (src/integrations)
  - External services. Google OAuth/token flow and server API.
  - Files: `integrations/google/*`, `integrations/server/keepApi.ts`.
- Services (src/services)
  - Cross-cutting helpers: HTTP wrapper, subscription cache, logging, paths, errors taxonomy.
  - Files: `services/http.ts`, `services/subscription.ts`, `services/logger.ts`, `services/paths.ts`, `services/errors.ts`.
- Schemas (src/schemas)
  - Zod schemas for runtime type validation of API responses and premium flags.
  - Files: `schemas/keep.ts`.
- Types (src/types)
  - TS types shared across layers and settings defaults.
  - Files: `types/*.ts`.
- Test Utilities (src/test-utils)
  - Reusable fixtures and mocks for tests.
  - Files: `test-utils/fixtures/*`, `test-utils/mocks/*`.

## Data Flow

1. User triggers import via ribbon or command (`@app/commands`).
2. Entry (`@app/main`) orchestrates UI and calls feature sync (`@features/keep/sync`).
3. Sync fetches paginated notes from server (`@integrations/server/keepApi`) using HTTP wrapper (`@services/http`).
4. Notes are normalized, deduped/merged, persisted; attachments downloaded; UI progress reported.
5. Results are logged to the configured sync log (`@app/logging` -> `@services/logger`).

## Conventions

- Use Obsidian APIs from wrappers (`@services/http`, `vault.adapter` via small facades).
- Maintain frontmatter keys: `GoogleKeepCreatedDate`, `GoogleKeepUpdatedDate`, `KeepSidianLastSyncedDate`.
- Use runtime schemas to validate external payloads.
- Prefer aliases (`@app`, `@ui`, `@features`, `@integrations`, `@services`, `@types`, `@schemas`).
- Barrels: use `barrelsby` to keep `index.ts` files current (prebuild step).
