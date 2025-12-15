# Release Process

This repository uses a GitHub Actions workflow for releases; the version bump scripts live under `scripts/`.

## Version bump

- `npm run version` updates `manifest.json` and `versions.json` and stages them.

## Build artifact

- Ensure `manifest.json` is in sync with the built `main.js` before publishing.
