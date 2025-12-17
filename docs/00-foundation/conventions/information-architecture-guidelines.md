# Information Architecture Guidelines (for LLM and humans)

Purpose: keep the project documentation IA consistent, link-clean, and traceable.

## Ground rules

- Use the numbered lifecycle folders only:
  - 00-foundation, 01-product, 02-research, 03-design, 04-architecture, 05-planning, 06-delivery,
    07-quality, 08-operations, 09-user-docs, 99-archive.
- Every top-level folder must contain an `index.md` describing purpose, subfolders, owners, and
  update cadence.
- Standardize on markdown links (no wikilinks). Relative links should be the shortest correct path
  from the current file.
- When adding new content, update the nearest index to include it and ensure it traces back to the
  source of truth (issue/spec) where relevant.
- Archive, don’t delete: move superseded docs into `99-archive/` with a one-line reason and
  successor link.

## Commands

- Check links: `npm run lint:links` (or `pnpm run lint:links`)
- Check IA shape: `npm run lint:ia` (or `pnpm run lint:ia`)
- Fix wikilinks to markdown (if any): `npm run lint:links:fix`

## How to add docs

1. Pick the correct lifecycle folder and create or reuse a subfolder; avoid new top-level buckets.
2. Add/update `index.md` to mention the new file and its maintainer.
3. Link back to the source of truth (issue/spec) and forward to tests/runbooks as applicable.
4. Run `npm run lint:links` and `npm run lint:ia` before opening a PR.

## Migration notes

- 2025-12-15: Initialized `docs/` with numbered lifecycle IA and added link/IA validation scripts.

## Ownership

- Plugin maintainers own `docs/README.md` and enforce IA/link checks in reviews.
