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
  - Collect: `src/features/keep/push.ts` scans `<saveLocation>` markdown files and referenced attachments
  - Push: `src/integrations/server/keepApi.ts` (`pushNotes`)
  - Update note frontmatter: `KeepSidianLastSyncedDate` is refreshed on success

## Frontmatter keys

The sync logic depends on these frontmatter keys in note files:

- `GoogleKeepCreatedDate`
- `GoogleKeepUpdatedDate`
- `KeepSidianLastSyncedDate`
- `GoogleKeepUrl` (updated on push when provided by the server)
