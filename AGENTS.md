# AGENTS.md

This file provides guidance to LLMS/autonomous agents when working with code in this repository.

## Development Commands

### Build and Development
- `npm run dev` - Start development mode with file watching and automatic rebuilding
- `npm run build` - Production build with TypeScript compilation check and linting
- `npm run test` - Run jest test suite
- `npm run coverage` - Generate test coverage report

### Barrels
- Barrels are auto-generated via `barrelsby`.
- `npm run barrels` updates barrels; it also runs automatically in `prebuild`.

### Code Quality, Linting & Fixes

- TypeScript + ESLint; Markdown lint via markdownlint.
- `npm run lint` - Run both TypeScript and markdown linting
- `npm run lint:ts` - Check TypeScript files for ESLint issues
- `npm run lint:ts:fix` - Auto-fix TypeScript linting issues
- `npm run lint:md` - Check markdown files with markdownlint
- `npm run lint:md:fix` - Auto-fix markdown formatting issues
- `npm run lint:fix` - Fix both TypeScript and markdown issues

Restricted imports:
- `@typescript-eslint/no-restricted-imports` blocks runtime imports from `@types/*`; use `import type` instead.

### Testing

- Test runner: Jest with setup in `src/tests/setup.ts`.
- Unit tests live alongside features under `src/**/tests/*.test.ts` and `src/tests`.
- Mocks: Global mocks in `__mocks__/` when needed.
- Commands:
  - `npm run test` runs tests.
  - `npm run coverage` generates coverage via c8/V8.

### Versioning & Release
- `npm run version` updates `manifest.json` and `versions.json`
- `npm run preversion` runs full lint.
- Keep `manifest.json` in sync with built `main.js`.

## Architecture Overview

### Plugin Structure

This is an Obsidian plugin built with TypeScript that integrates Google Keep notes into Obsidian. It uses a Flask server for communication with Google Keep and provides a user interface within Obsidian for syncing notes. The plugin is structured into several key components, each responsible for specific functionality.

### Key Architectural Components

#### High-level Flow
- User triggers sync via ribbon/command registered in `src/app/commands.ts` (entry remains `src/main.ts`).
- Plugin calls server endpoints (configured in `src/config/index.ts`) through the HTTP wrapper in `src/services/http.ts`.
- Notes are paginated, normalized, de-duplicated/merged, written to the vault, and attachments downloaded (orchestrated in `src/features/keep/sync.ts`).
- UI updates status bar and modal with total count and progress via `src/app/sync-ui.ts`; results are logged using `src/app/logging.ts`.

#### Core Files

- `src/main.ts`: Obsidian plugin entry. Registers ribbon/commands, loads/saves settings, handles auto-sync, and delegates UI/logging.
- `src/app/commands.ts`: Ribbon and command registration.
- `src/app/sync-ui.ts`: Status bar and progress modal orchestration.
- `src/app/logging.ts`: App-level logging that writes to the sync log via `src/services/logger.ts`.
- `src/features/keep/sync.ts`: Sync orchestration (fetch, pagination, processing, persistence, progress callbacks).
- `src/features/keep/domain/note.ts`: Note normalization utilities (frontmatter, title/body, dates).
- `src/features/keep/domain/compare.ts`: Duplicate detection and resolution using content/updated dates/last sync timestamp.
- `src/features/keep/domain/merge.ts`: Body merge utility for conflict-free merges.
- `src/features/keep/io/attachments.ts`: Downloads blobs into a `media` subfolder using Obsidian APIs.
- `src/integrations/server/keepApi.ts`: Server API calls for fetching notes (standard and premium).
- `src/integrations/google/keepToken.ts`: OAuth token retrieval (embedded webview + server-side exchange).
- `src/ui/*`: Settings tabs, import options modal, progress modal, and related UI.
- `src/services/http.ts`: Wrapper around Obsidian `requestUrl` used by integrations and services.
- `src/services/subscription.ts`: Subscription cache and status checks; used to gate premium features.
- `src/services/paths.ts`: Path helpers (normalize/build save locations; media folder path).
- `src/services/errors.ts`: Error taxonomy for network/parse/IO and helpers.
- `src/types/*`: Settings, subscription, and helper type definitions (barrels available).
- `src/config/index.ts`: Server base URL (`KEEPSIDIAN_SERVER_URL`). Must not end with a trailing slash.

#### Data Flow

- Trigger: `KeepSidianPlugin.importNotes(auto?: boolean)` in `src/main.ts`.
- Fetch: `fetchNotes` / `fetchNotesWithPremiumFeatures` from `src/integrations/server/keepApi.ts` with headers `X-User-Email` and `Authorization: Bearer <token>`.
- Pagination: `offset`/`limit` loop in `importGoogleKeepNotesBase` within `src/features/keep/sync.ts` until an empty page.
- Total count: If the API includes `total_notes`, call `setTotalNotes(plugin, total)` from `src/app/sync-ui.ts`.
- Processing: `processAndSaveNotes` → per note `processAndSaveNote`:
  - Normalize note (title, body, frontmatter) via `domain/note.ts`.
  - Decide action with `handleDuplicateNotes`: `skip` | `rename` | `overwrite`.
  - Merge content when conflict-free; otherwise suffix filename with `-conflict-<ISO date>`.
  - Persist frontmatter including `KeepSidianLastSyncedDate` and body.
  - Download attachments into `<saveLocation>/media` via `io/attachments.ts`.
  - Report progress back to the plugin UI via `reportSyncProgress(plugin)`.
- Logging: `logSync(plugin, message)` appends `[ISO_TIMESTAMP] <message>` into `<saveLocation>/<syncLogPath>`.

#### UI/UX Conventions

- Status: Status bar item shows compact progress with determinate/indeterminate bar.
- Modal: `SyncProgressModal` shows detail and final state; clicking status bar opens it.
- Notices: Use `new Notice()` sparingly for start/end and error states.

#### Configuration

- Server URL: `src/config/index.ts` → `KEEPSIDIAN_SERVER_URL` (no trailing slash). Do not commit secrets.
- Settings: See `src/types/keepsidian-plugin-settings.ts`; persisted via `this.saveData` in `src/main.ts`.
- Save location: Plugin ensures folder and `media` subfolder exist before writes (helpers in `src/services/paths.ts`).

#### Subscription & Premium
- Status is cached for 24h in `SubscriptionService`. Active status enables premium import options.
- Premium flags are derived from `NoteImportOptions` and mapped to `PremiumFeatureFlags` (see `src/integrations/server/keepApi.ts`), sent to `/keep/sync/premium/v2`.

#### Implementation Tips for Agents
- Prefer Obsidian APIs via `src/services/http.ts` (wraps `requestUrl`) and `vault.adapter` for IO.
- Use `@schemas/*` for runtime validation of external payloads.
- Always normalize composed vault paths; avoid unsafe filename characters (`src/services/paths.ts`).
- Maintain frontmatter keys used for logic: `GoogleKeepCreatedDate`, `GoogleKeepUpdatedDate`, `KeepSidianLastSyncedDate`.
- Use `handleDuplicateNotes` before write; only merge when merge utility returns `hasConflict === false`.
- For progress: use `setTotalNotes(plugin, ...)` and `reportSyncProgress(plugin)` from `src/app/sync-ui.ts`.
- Catch and surface errors with `Notice` and console logging; avoid throwing unhandled errors from UI callbacks.
- Keep network contracts: headers and endpoints live in `src/integrations/server/keepApi.ts` and token flow in `src/integrations/google/keepToken.ts`.

### Path Aliases
- Use: `@app/*`, `@ui/*`, `@features/*`, `@integrations/*`, `@services/*`, `@types/*`, `@schemas/*`.

#### Common Tasks

- Add a new API call: Implement in `src/integrations/server/keepApi.ts` using `src/services/http.ts`; validate JSON defensively.
- Extend settings/UI: Add fields in `src/types/keepsidian-plugin-settings.ts`, render/edit in `src/ui/settings/*`, persist via `saveSettings()`.
- Change save location structure: Update `processAndSaveNotes` and related helpers in `src/services/paths.ts`; ensure folders exist before writes.
- Adjust duplicate strategy: Modify `src/features/keep/domain/compare.ts` and update tests under `src/features/keep/domain/tests/*`.

#### Troubleshooting
- No notes imported: Check token (`src/integrations/google/keepToken.ts`), server URL in `src/config/index.ts`, and Notices/console errors.
- Attachments missing: Verify `blob_urls` values, media folder creation, and `writeBinary` success.
- UI not updating: Ensure `setTotalNotes` is called when API includes `total_notes`, and `reportSyncProgress` is invoked per note.

## Also

- DO use detailed conventional commit messages for git
- ONLY edit files using the standard file edit tool, not with commands
- DO NOT add your signature to git commit messages
- DO NOT add "Generated with Claud Code" or anthing like that anywhere
- DO NOT add "Co-Authored-By" anywhere
- DO NOT prefix comments with "ABOUTME"
