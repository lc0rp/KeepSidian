# Documentation System

Purpose: single navigation point for the future docs IA that scales from one squad to multi-team operations while
staying LLM-friendly.

Linking: standardize on markdown links (no wikilinks); run `npm run lint:links` (or `pnpm run lint:links`) to catch
strays.

Flow (ordered by lifecycle):

- [00-foundation](./00-foundation/index.md)
- [01-product](./01-product/index.md)
- [02-research](./02-research/index.md)
- [03-design](./03-design/index.md)
- [04-architecture](./04-architecture/index.md)
- [05-planning](./05-planning/index.md)
- [06-delivery](./06-delivery/index.md)
- [07-quality](./07-quality/index.md)
- [08-operations](./08-operations/index.md)
- [09-user-docs](./09-user-docs/index.md)
- [99-archive](./99-archive/index.md)

Caretakers: each index lists primary roles and update cadence; scrum master keeps this top index in sync at sprint
start/end. Run `npm run lint:links` and `npm run lint:ia` before merging (or the `pnpm` equivalents).
