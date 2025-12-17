# Release Process

This repository uses a GitHub Actions workflow for releases; the version bump scripts live under
`scripts/`.

## Release Workflow

**Note:** No need to manually update the KEEPSIDIAN_SERVER_URL in `.env.production` - This is
handled in the release script.

- Preview the release steps without side effects:

```bash
printf "1\n" | node scripts/release.mjs --dry-run
```

- Run `npm run release` after reviewing the dry run output to create the build, bump the version,
  and push tags.

## Version bump

- `npm run version` updates `manifest.json` and `versions.json` and stages them.

## Build artifact

- Ensure `manifest.json` is in sync with the built `main.js` before publishing.
