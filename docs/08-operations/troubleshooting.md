# Troubleshooting

## Download sync imported nothing

- Verify email/token in settings.
- Verify server URL configuration in `src/config/index.ts` (no trailing slash).
- Check the latest sync log under `<saveLocation>/_KeepSidianLogs/`.

## Upload is locked

Uploads are gated behind two-way safeguards; the plugin will show a notice with the required prerequisites (opt-in,
subscription status, auto-sync toggles).

## Attachments missing on upload

- Only attachments referenced from the note content and resolving into `<saveLocation>/media/` are considered.
- Missing attachments are logged per-note in the sync log.
