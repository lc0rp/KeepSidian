# Tech-Spec: Mobile-Safe KeepSidian Settings & Sync

**Created:** 2025-12-17  
**Status:** Ready for Development

## Overview

### Problem Statement

KeepSidian fails to load on Obsidian Mobile because Electron-only imports (`electron`, `<webview>`) are pulled during plugin initialization. The token retrieval wizard relies on Electron webviews, which have no mobile equivalent. We need a mobile-safe path that preserves desktop behavior and allows mobile users to sync using an already-synced token or manual token entry.

### Solution

- Gate all Electron-dependent code behind runtime platform checks so it never executes on mobile.
- Provide a mobile settings UI that omits the token retrieval wizard but still allows viewing/editing a token.
- Defer loading `keepToken` and any Electron imports until a desktop user explicitly opens the wizard.
- Keep core sync/push flows unchanged; they already rely on mobile-safe Obsidian APIs.

### Scope (In/Out)

- In: Settings tab refactor for platform-aware rendering; lazy Electron imports; mobile-safe initialization; manual token entry on mobile; ensuring desktop token continues syncing via Obsidian settings data.
- Out: Building a new mobile OAuth flow; background service reliability improvements on mobile; bundle-size optimization beyond reasonable hygiene.

## Context for Development

### Codebase Patterns

- Obsidian plugin with esbuild bundling; externals include `obsidian`, `electron`.
- Path aliases via tsconfig (`@app/*`, `@ui/*`, etc.).
- Settings tab registered in `src/app/main.ts`; token wizard in `src/ui/settings/KeepSidianSettingsTab.ts`; Electron flow in `src/integrations/google/keepToken.ts`.
- Platform detection available from `Platform` in `obsidian`.

### Files to Reference

- `src/app/main.ts` — registers settings tab.
- `src/ui/settings/KeepSidianSettingsTab.ts` — settings UI + token wizard.
- `src/integrations/google/keepToken.ts` — Electron webview OAuth flow.
- `esbuild.config.mjs` — bundling config (externalizes `electron`).
- `docs/02-research/mobile-compatibility.md` — prior findings.

### Technical Decisions

- Use `Platform.isDesktopApp` / `Platform.isMobileApp` from Obsidian to branch UI/flows.
- Convert Electron imports in TS to `import type` and perform `const { <api> } = require("electron")` inside desktop-only branches to avoid mobile runtime errors.
- Keep token retrieval wizard desktop-only; on mobile, hide the button and surface manual token input.
- Lazy-load `keepToken` on desktop when the wizard starts to keep mobile bundle safe even if code is present.

## Implementation Plan

### Tasks

- [ ] Add platform utilities or inline helper to detect desktop vs mobile using `Platform`.
- [ ] Update `KeepSidianSettingsTab`:
  - [ ] Switch `electron` import to `import type`.
  - [ ] Render token retrieval wizard only when `Platform.isDesktopApp` is true.
  - [ ] Ensure manual token text field is always available; add hint for mobile users to paste desktop-synced token.
  - [ ] Lazy-import `keepToken` functions inside the desktop-only click handler.
- [ ] Update `keepToken.ts`:
  - [ ] Convert `electron` imports to `import type` and guard all runtime access with desktop checks.
  - [ ] Export a no-op or error message early if invoked on mobile (defensive).
- [ ] Update `app/main.ts`:
  - [ ] Guard settings tab registration or its desktop-only parts so plugin load does not require Electron on mobile.
- [ ] Optional: Add a small badge/notice in settings when on mobile explaining manual token requirement.
- [ ] Tests:
  - [ ] Add unit test stubs that simulate mobile env (mock `Platform.isMobileApp`) to ensure no Electron require occurs.
  - [ ] Re-run existing Jest suite.

### Acceptance Criteria

- [ ] Plugin loads without errors on Obsidian Mobile (iOS/Android) with Electron unavailable.
- [ ] Settings view renders on mobile; sync token field editable; no token wizard button shown on mobile.
- [ ] Desktop behavior unchanged: token wizard works via Electron webview; settings tab still renders.
- [ ] Sync/push flows operate on mobile when a token is present (manually set or synced from desktop).
- [ ] Bundling leaves `electron` external, and no runtime `require("electron")` executes on mobile code paths.

## Additional Context

### Dependencies

- Obsidian `Platform` API.
- Existing server endpoints unchanged.

### Testing Strategy

- Unit: mock `Platform.isMobileApp` to verify desktop-only branches are skipped; ensure no Electron require is called.
- Manual:
  - Desktop: run token wizard and sync.
  - Mobile: install plugin build, open settings, confirm no crash, paste token, run sync/push.

### Notes

- Background sync timers may still be throttled on mobile; out of scope for this change.
