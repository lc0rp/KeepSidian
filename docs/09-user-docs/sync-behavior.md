# Sync Behavior

## Download

- Notes are written under the configured save location.
- KeepSidian records the last successful download timestamp and uses it to fetch only notes created/updated after that.
- Sync logs are written under `<saveLocation>/_KeepSidianLogs/` (rotated daily).

## Upload

- KeepSidian scans markdown files under the save location (excluding `media/` and `_KeepSidianLogs/`).
- A note is eligible for upload when:
  - it has never been synced (`KeepSidianLastSyncedDate` missing), or
  - the note file has been modified since its last sync timestamp, or
  - referenced attachments under `media/` have changed since last sync.
- Attachments:
  - KeepSidian includes attachments referenced by the note content that resolve into `<saveLocation>/media/`.
  - Missing attachments are logged and skipped.

## Conflicts

When both a local note and its Google Keep counterpart have changed since the last sync, KeepSidian attempts to merge
the note bodies. If a conflict remains, the incoming note is saved as a `-conflict-<timestamp>.md` copy.
