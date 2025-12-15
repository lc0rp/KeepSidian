# Docs update (2025-12-15)

## Summary

- Added a numbered `docs/` information architecture and section indexes.
- Added link and IA validation scripts and wiring via npm scripts.
- Updated user-facing README to reflect current upload/attachment behavior.
- Removed `docs` from `.gitignore` so documentation is versioned in this repo.

## Rationale

The repo previously had only a root `README.md`. This migration establishes a scalable structure for maintainer and
user documentation, with automated checks to prevent broken links and drift.
