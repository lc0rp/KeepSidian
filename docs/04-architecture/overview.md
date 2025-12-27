# Architecture Overview

KeepSidian is an Obsidian plugin (TypeScript) that syncs notes via a companion server.

## High-level flow

- Entry point: `src/main.ts` re-exports `src/app/main.ts`.
- Commands/ribbon: `src/app/commands.ts` calls methods on `KeepSidianPlugin`.
- Download pipeline:
  - Fetch: `src/integrations/server/keepApi.ts` (`fetchNotes*`)
  - Orchestrate/process: `src/features/keep/sync.ts`
  - Normalize/merge/compare: `src/features/keep/domain/*`
  - Attachments: `src/features/keep/io/attachments.ts` → `<saveLocation>/media/`
  - Logging: `src/app/logging.ts` → `<saveLocation>/_KeepSidianLogs/YYYY-MM-DD.md`
- Upload pipeline:
  - Collect: `src/features/keep/push.ts` scans `<saveLocation>` markdown files and referenced
    attachments
  - Push: `src/integrations/server/keepApi.ts` (`pushNotes`)
  - Update note frontmatter: `KeepSidianLastSyncedDate` is refreshed on success

## Token retrieval (desktop)

- Settings tab offers Playwright/Puppeteer automation buttons.
- Automation launches `keepTokenBrowserAutomationDesktop.js` to drive a real browser, overlay
  instructions, and return an OAuth cookie token.
- `exchangeOauthToken` posts the short-lived OAuth token to the server and stores the long-lived
  keep token in settings.

## Download filtering and pagination

- Downloads page through notes using `offset`/`limit`.
- If a “last successful download” timestamp exists, it is sent as filters (`created_gt`,
  `updated_gt`) so the server can return only notes created/updated after that timestamp.
- The server may include `total_notes`; when present, the UI switches from indeterminate to
  determinate progress.

## Frontmatter keys

The sync logic depends on these frontmatter keys in note files:

- `GoogleKeepCreatedDate`
- `GoogleKeepUpdatedDate`
- `KeepSidianLastSyncedDate`
- `GoogleKeepUrl` (updated on push when provided by the server)

## Where state is stored

- Sync folder: `settings.saveLocation`.
- Last successful download timestamp:
  - `settings.keepSidianLastSuccessfulSyncDate`, and
  - Obsidian vault config key `KeepSidianLastSuccessfulSyncDate` (best-effort, when available).
- Sync logs:
  - `settings.lastSyncLogPath` is updated on write.
  - Logs are appended under `<saveLocation>/_KeepSidianLogs/` and rotated daily.
