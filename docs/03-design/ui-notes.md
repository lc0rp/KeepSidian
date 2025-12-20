# UI Notes

## Sync UI

- Status bar:
  - Initialized via `initializeStatusBar` in `src/app/sync-ui.ts`.
  - Shows sync state and progress; clicking opens the progress modal.
- Modal:
  - Driven by `SyncProgressModal` in `src/ui/modals/SyncProgressModal`.
  - Orchestrated via `startSyncUI` / `finishSyncUI` in `src/app/sync-ui.ts`.
- Notices:
  - Used for start/end, error states, and live progress updates during sync.
  - Updates prefer `Notice#setMessage` with a `noticeEl` fallback; avoid spamming.

## Settings

- Settings UI lives under `src/ui/settings/`.
- Two-way sync safeguards are surfaced via a structured Notice in
  `KeepSidianPlugin.showTwoWaySafeguardNotice`.
