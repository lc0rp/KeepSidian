# Recommended Repo Structure Improvements

Here’s a focused, “best practice” upgrade path for your repo structure. Overall it’s already solid; these changes aim to improve separation of concerns, testability, and discoverability without breaking Obsidian conventions.

## Key Opportunities

- Decouple layers: Separate plugin entry, UI, feature logic, and integrations to reduce cross‑coupling.
- Consolidate HTTP + IO: Wrap requestUrl centrally and avoid mixing Obsidian APIs deep in domain code.
- Tame main.ts: Move status/progress UI and logging to their own modules and keep the plugin entry lean.
- Standardize tests + exports: Co-locate tests consistently and add index “barrels” for cleaner imports.

## Proposed Structure

- src/app: Plugin entry + orchestration
- src/app/main.ts (current src/main.ts:1) — keep as entry, slimmed down
[x] - src/app/commands.ts — commands, ribbon wiring (DONE)
[x] - src/app/sync-ui.ts — status bar + modal orchestration currently in src/main.ts:1 (DONE)
[x] - src/app/logging.ts — extracted from src/main.ts:220 (DONE)

[x] - src/ui: View components, by concern (DONE)
[x] - src/ui/settings/KeepSidianSettingsTab.ts (move from src/components/KeepSidianSettingsTab.ts:1) (DONE)
[x] - src/ui/settings/SubscriptionSettingsTab.ts (move from src/components/SubscriptionSettingsTab.ts) (DONE)
[x] - src/ui/modals/NoteImportOptionsModal.ts (move from src/components/NoteImportOptionsModal.ts) (DONE)
[x] - src/ui/modals/SyncProgressModal.ts (move from src/components/SyncProgressModal.ts) (DONE)

[x] - src/features/keep: Feature domain (Keep note handling) (DONE)
[x] - src/features/keep/domain/note.ts (move from src/google/keep/note.ts:1) (DONE)
[x] - src/features/keep/domain/compare.ts (move from src/google/keep/compare.ts:1) (DONE)
[x] - src/features/keep/domain/merge.ts (move from src/google/keep/merge.ts) (DONE)
[x] - src/features/keep/io/attachments.ts (move from src/google/keep/attachments.ts:1) (DONE)
[x] - src/features/keep/sync.ts — orchestration split from src/google/keep/import.ts:1 (keeps pagination, progress reporting, persistence) (DONE)

[x] - src/integrations: External systems (server + Google) (DONE)
[x] - src/integrations/server/keepApi.ts — API calls split out from src/google/keep/import.ts:1 (fetchNotes*, parseResponse) (DONE)
[x] - src/integrations/google/keepToken.ts (move from src/google/keep/token.ts:1) (DONE)
[x] - src/integrations/google/drive/*.ts (move from src/google/drive/*) (DONE)

[x] - src/services: Cross-cutting helpers (DONE)
[x] - src/services/http.ts — wraps Obsidian requestUrl (apply to src/services/subscription.ts:1 and keep API) (DONE)
[x] - src/services/subscription.ts:1 — use http.ts and unify error handling (DONE)
[x] - src/services/logger.ts — durable sync log write (used by app/logging.ts) (DONE)
[x] - src/services/paths.ts — path helpers (normalizePath, save locations) (DONE)

[x] - src/config: Keep as-is for tool configs; consider adding runtime config (DONE)
[x] - src/config/index.ts — re-export KEEPSIDIAN_SERVER_URL (src/config.ts:1) (DONE)
[x] - src/types: Keep domain types and d.ts; add barrels (DONE)
[x] - src/types/index.ts — re-export settings, subscription, shared types (DONE)
- src/schemas: typed runtime validation
- src/schemas/keep.ts — Zod schemas for API responses (replaces ad‑hoc parseResponse)
- src/test-utils: Jest helpers/fixtures (optional)
- src/test-utils/fixtures/* — JSON fixtures for keep responses
- src/test-utils/mocks/* — helpers beyond __mocks__/

Note on Obsidian CSS: keeping styles.css at repo root is normal for plugins; don’t move unless you add a build step to output to root.

## Low-Risk Quick Wins

[x] - HTTP wrapper: Add src/services/http.ts to centralize Obsidian requestUrl and headers. (DONE)
[x] - Update src/services/subscription.ts:1 to use it (and stop using fetch). (DONE)
[x] - Update keep API calls (currently in src/google/keep/import.ts:1) to use the wrapper. (DONE)
[x] - Barrels: Add index.ts in src/ui, src/features/keep/domain, src/services, src/types for simpler imports. (DONE)
[x] - Constants: Extract frontmatter keys and sync constants from src/google/keep/note.ts:1, src/google/keep/compare.ts:1 to src/features/keep/constants.ts. (DONE)
[x] - Tests co-location: Standardize on src/__/tests/*.test.ts everywhere. (DONE)
- Move src/tests/main.test.ts:1 alongside src/app/main.ts
[x] - Scripts folder: Move version-bump.mjs to scripts/version-bump.mjs and update package.json scripts. (DONE)

## Medium Refactors

[x] - Slim main.ts: Extract progress UI and logging to src/app/sync-ui.ts and src/app/logging.ts and keep src/main.ts:1 to lifecycle + high‑level orchestration only. (DONE)

Split import flow:
[x] - src/features/keep/sync.ts orchestrates pagination, dedupe/merge, persistence, and progress callbacks. (DONE)
[x] - src/integrations/server/keepApi.ts holds fetchNotes and fetchNotesWithPremiumFeatures. (DONE)

Narrow interfaces over KeepSidianPlugin:
[x] - Replace imports like import KeepSidianPlugin from 'main' in lower layers (src/google/keep/attachments.ts:1, src/google/keep/import.ts:1) with small interfaces (e.g., { vault: { adapter: { exists, write, writeBinary, stat }}}) passed in, improving testability and reducing coupling. (DONE for attachments; import.ts now facades new modules)

## Bigger Wins (Optional)

- Runtime validation: Replace parseResponse in src/google/keep/import.ts:1 with schemas (src/schemas/keep.ts) for safer API parsing and better testability.
- Path aliases: You already use baseUrl: "src" in tsconfig.json:1; consider explicit aliases:
  Example paths: @app/*, @ui/*, @features/*, @integrations/*, @services/*, @types/*.
- Update jest.config.ts:1 moduleNameMapper to match.
- Error taxonomy: Add src/services/errors.ts for typed errors (network, parse, IO) and unify notices/messages.
- Docs alignment: Create docs/architecture.md summarizing the layered structure (complementing AGENTS.md), and docs/contributing.md for code org/naming conventions.

## Concrete File Targets

[x] - src/main.ts:1: Extract status bar + modal logic and logging into src/app/sync-ui.ts and src/app/logging.ts. (DONE)
[x] - src/services/subscription.ts:1: Replace fetch with an http.ts wrapper built on requestUrl for consistency with Obsidian. (DONE)
[x] - src/google/keep/import.ts:1: Move fetchNotes* to src/integrations/server/keepApi.ts, keep orchestration in src/features/keep/sync.ts. (DONE)
[x] - src/google/keep/attachments.ts:1: Replace direct KeepSidianPlugin dependency with a minimal adapter interface argument. (DONE)
- jest.config.ts:1: Update moduleNameMapper after alias/barrel changes.

## Why this helps

- Clarity: Each folder communicates its responsibility (app, ui, features, integrations, services).
- Testability: Narrowed interfaces and centralized IO/HTTP make unit tests simpler and faster.
- Maintainability: Smaller main.ts, better exports, and consistent test placement reduce cognitive load.
- Scalability: Adding new features or integrations won’t tangle with core plugin concerns.
