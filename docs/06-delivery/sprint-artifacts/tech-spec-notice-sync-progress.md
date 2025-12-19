# Tech-Spec: Notice Sync Progress

**Created:** 2025-12-19 **Status:** done

## Overview

### Problem Statement

During sync, the Obsidian `Notice` displays a static message ("Syncing Google Keep Notes..."). Users already see
progress in the status bar and progress bar, but the Notice does not reflect progress, making it feel stale and less
informative.

### Solution

Update the sync Notice to include progress data (processed/total) while syncing. Reuse the existing processed and total
counts, and update the Notice message as progress is reported or total count becomes known.

### Scope (In/Out)

**In scope:**

- Show progress in the sync Notice message (e.g., "Syncing Google Keep Notes... 10/145").
- Keep message in sync with processed count and total (when available).
- Update related tests to reflect the new Notice text.

**Out of scope:**

- UI redesign of status bar or progress modal.
- Changing progress counting or pagination logic.
- New configuration options for notice formatting.

## Context for Development

### Codebase Patterns

- Sync UI state lives in `src/app/sync-ui.ts`.
- `Notice` updates use a casted control interface (`NoticeWithControls`) and `setMessage` when available.
- `processedNotes` and `totalNotes` are stored on `KeepSidianPlugin`.

### Files to Reference

- `src/app/sync-ui.ts` (functions: `startSyncUI`, `reportSyncProgress`, `setTotalNotes`, `finishSyncUI`)
- `src/app/main.ts` (progress state fields)
- `src/app/tests/main.test.ts` (Notice expectations)

### Technical Decisions

- Add a small helper for consistent Notice text formatting.
- Use `setMessage` to update the Notice without recreating it.
- If total is unknown, display `?` (e.g., "0/?") to match status bar semantics.

## Implementation Plan

### Tasks

- [x] Add a Notice message formatter in `src/app/sync-ui.ts` (accepts processed and total).
- [x] Update `startSyncUI` to create the Notice with progress text (e.g., "Syncing Google Keep Notes... 0/?").
- [x] Update `reportSyncProgress` to set the Notice message with updated counts (if `setMessage` exists).
- [x] Update `setTotalNotes` to refresh the Notice message when total becomes known.
- [x] Update `src/app/tests/main.test.ts` expectations to match the new Notice message (or assert it contains the
      prefix + progress).

### Acceptance Criteria

- [x] Given a sync starts, when the Notice appears, then it includes progress text (e.g., "0/?" or "0/145").
- [x] Given progress updates, when `reportSyncProgress` runs, then the Notice message reflects the updated processed
      count.
- [x] Given total notes are set, when `setTotalNotes` runs, then the Notice message reflects the total.
- [x] Existing tests pass with updated Notice expectations.

## Additional Context

### Dependencies

- No new dependencies.
- Relies on Obsidian `Notice` having optional `setMessage` method (already used in `finishSyncUI`).

### Testing Strategy

- Update unit tests in `src/app/tests/main.test.ts` to reflect the Notice message including progress.
- No new test framework or integration tests needed.

### Notes

- Keep message prefix "Syncing Google Keep Notes..." unchanged to avoid user confusion; append progress to the end.
- If `setMessage` is unavailable, do not error; leave Notice text unchanged.

## Dev Agent Record

### File List

- `.gitignore`
- `.markdownlint-cli2.jsonc`
- `src/app/sync-ui.ts`
- `src/app/tests/main.test.ts`
- `docs/06-delivery/sprint-artifacts/tech-spec-notice-sync-progress.md`

### Test Summary

- `npm run test -- src/app/tests/main.test.ts` (passed 2025-12-19, rerun after notice clamp)

### Build/Lint Summary

- `npm run lint` (passed 2025-12-19)
- `npm run build` (passed 2025-12-19)
