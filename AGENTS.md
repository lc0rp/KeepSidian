# AGENTS.md

This file provides guidance to LLMS/autonomous agents when working with code in this repository.

## Development Commands

### Build and Development
- `npm run dev` - Start development mode with file watching and automatic rebuilding
- `npm run build` - Production build with TypeScript compilation check and linting
- `npm run test` - Run jest test suite
- `npm run coverage` - Generate test coverage report

### Code Quality, Linting & Fixes

- TypeScript + ESLint; Markdown lint via markdownlint.
- `npm run lint` - Run both TypeScript and markdown linting
- `npm run lint:ts` - Check TypeScript files for ESLint issues
- `npm run lint:ts:fix` - Auto-fix TypeScript linting issues
- `npm run lint:md` - Check markdown files with markdownlint
- `npm run lint:md:fix` - Auto-fix markdown formatting issues
- `npm run lint:fix` - Fix both TypeScript and markdown issues

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
- User triggers sync via ribbon/command in `src/main.ts`.
- Plugin calls server endpoints (configured in `src/config.ts`) using Obsidian `requestUrl`.
- Notes are paginated, normalized, de-duplicated/merged, written to the vault, and attachments downloaded.
- UI updates status bar and modal with total count and progress; results are logged to a sync log file.

#### Core Files

- `src/main.ts`: Obsidian plugin entry. Registers commands/ribbon, loads/saves settings, handles auto-sync, progress UI, and logging.
- `src/google/keep/import.ts`: Sync driver. Fetches notes (standard or premium), parses responses, orchestrates processing and pagination, and reports progress.
- `src/google/keep/note.ts`: Note normalization utilities (frontmatter extraction, title/body processing, date handling).
- `src/google/keep/compare.ts`: Duplicate detection and resolution strategy using content, updated dates, and last sync timestamp.
- `src/google/keep/merge.ts`: Body merge utility for conflict-free merges.
- `src/google/keep/attachments.ts`: Downloads blobs into a `media` subfolder using `requestUrl` and vault binary writes.
- `src/google/keep/token.ts`: OAuth token retrieval via embedded webview and server-side exchange; updates `plugin.settings.token`.
- `src/components/*`: Settings tab, import options modal, progress modal, and related UI.
- `src/services/subscription.ts`: Subscription cache and status checks; used to gate premium features.
- `src/types/*`: Settings, subscription, and helper type definitions.
- `src/config.ts`: Server base URL (`KEEPSIDIAN_SERVER_URL`). Must not end with a trailing slash.

#### Data Flow

- Trigger: `KeepSidianPlugin.importNotes(auto?: boolean)` in `src/main.ts`.
- Fetch: `fetchNotes`/`fetchNotesWithPremiumFeatures` with headers: `X-User-Email` and `Authorization: Bearer <token>`.
- Pagination: `offset`/`limit` loop in `importGoogleKeepNotesBase` until empty page.
- Total count: If API returns `total_notes`, `main.setTotalNotes(total)` updates progress UI.
- Processing: `processAndSaveNotes` → per note `processAndSaveNote`:
  - Normalize note (title, body, frontmatter).
  - Decide action with `handleDuplicateNotes`: `skip` | `rename` | `overwrite`.
  - Merge content when conflict-free; otherwise suffix filename with `-conflict-<ISO date>`.
  - Persist frontmatter including `KeepSidianLastSyncedDate` and body.
  - Download attachments into `<saveLocation>/media`.
  - Report progress back to the plugin UI.
- Logging: `logSync` appends `[ISO_TIMESTAMP] <message>` into `<saveLocation>/<syncLogPath>`.

#### UI/UX Conventions

- Status: Status bar item shows compact progress with determinate/indeterminate bar.
- Modal: `SyncProgressModal` shows detail and final state; clicking status bar opens it.
- Notices: Use `new Notice()` sparingly for start/end and error states.

#### Configuration

- Server URL: `src/config.ts` → `KEEPSIDIAN_SERVER_URL` (no trailing slash). Do not commit secrets.
- Settings: See `src/types/keepsidian-plugin-settings.ts`; persisted via `this.saveData` in `src/main.ts`.
- Save location: Plugin ensures folder and `media` subfolder exist before writes.

#### Subscription & Premium
- Status is cached for 24h in `SubscriptionService`. Active status enables premium import options.
- Premium flags are derived from `NoteImportOptions` and sent to `/keep/sync/premium/v2`.

#### Implementation Tips for Agents
- Prefer Obsidian APIs: use `requestUrl` and `vault.adapter` instead of Node fs/fetch directly.
- Always `normalizePath` when composing vault paths; avoid unsafe characters in filenames.
- Maintain frontmatter keys used for logic: `GoogleKeepCreatedDate`, `GoogleKeepUpdatedDate`, `KeepSidianLastSyncedDate`.
- Use `handleDuplicateNotes` before write; only merge when merge utility returns `hasConflict === false`.
- For progress: call `plugin.setTotalNotes` when available and `plugin.reportSyncProgress()` per processed note.
- Catch and surface errors with `Notice` and console logging; avoid throwing unhandled errors from UI callbacks.
- Keep network contracts: headers and endpoints in `src/google/keep/import.ts` and `src/google/keep/token.ts`.

#### Common Tasks

- Add a new API call: Put request code in `src/google/keep/*.ts` using `requestUrl`, validate JSON defensively (support both `response.json()` and `response.text`).
- Extend settings/UI: Add fields in `src/types/keepsidian-plugin-settings.ts`, render/edit in `src/components/KeepSidianSettingsTab.ts`, persist via `saveSettings()`.
- Change save location structure: Update `processAndSaveNotes` and ensure new folders are created when missing.
- Adjust duplicate strategy: Modify `src/google/keep/compare.ts` and update tests in `src/google/keep/tests/*`.

#### Troubleshooting
- No notes imported: Check token (`src/google/keep/token.ts`), server URL in `src/config.ts`, and Notices/console errors.
- Attachments missing: Verify `blob_urls` values, media folder creation, and `writeBinary` success.
- UI not updating: Ensure `setTotalNotes` is called when API includes `total_notes`, and `reportSyncProgress` is invoked per note.

## Also

- DO use detailed conventional commit messages for git
- DO NOT add your signature to git commit messages
- DO NOT add "Generated with Claud Code" or anthing like that anywhere
- DO NOT add "Co-Authored-By" anywhere
- DO NOT prefix comments with "ABOUTME"
