# Linting

## Commands

- TypeScript: `npm run lint:ts`
- Markdown: `npm run lint:md`
- Links (markdown-only, no wikilinks): `npm run lint:links`
- Docs IA shape: `npm run lint:ia`

## Notes

- Prettier is the formatter for TS/JS; see `prettier.config.cjs`.
- `@typescript-eslint/no-explicit-any` is enforced; prefer `unknown` plus narrowing.
