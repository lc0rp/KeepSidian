# Product Overview

KeepSidian syncs notes between Google Keep and Obsidian via a companion server.

## Scope

- Sync directions:
  - Download: Google Keep → Obsidian (`Download notes from Google Keep`)
  - Upload: Obsidian → Google Keep (`Upload notes to Google Keep`)
  - Two-way: download, then upload (`Perform two-way sync`)
- Attachments:
  - Downloaded attachments are stored under `<saveLocation>/media/`.
  - Upload attempts to include attachments referenced from a note that resolve into
    `<saveLocation>/media/`.

## Key constraints

- Uploads are gated behind opt-in safeguards in settings and may require an active subscription,
  depending on the configured safeguards and server policy.
- Sync is server-backed; `KEEPSIDIAN_SERVER_URL` must be configured in `src/config/index.ts` and
  must not have a trailing slash.
