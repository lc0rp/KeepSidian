# Tech-Spec: Mobile-Safe KeepSidian Settings & Sync

**Created:** 2025-12-17  
**Status:** Implemented (Needs Mobile QA)
**Updated:** 2025-12-19

## Overview

### Problem Statement

KeepSidian fails to load on Obsidian Mobile because Electron-only imports (`electron`, `<webview>`)
are pulled during plugin initialization. The token retrieval wizard relies on Electron webviews,
which have no mobile equivalent. We need a mobile-safe path that preserves desktop behavior and
allows mobile users to sync using an already-synced token or manual token entry.

### Solution

- Gate all Electron-dependent code behind runtime platform checks so it never executes on mobile.
- Provide a mobile settings UI that omits the token retrieval wizard but still allows
  viewing/editing a token.
- Defer loading `keepToken` and any Electron imports until a desktop user explicitly opens the
  wizard.
- Keep core sync/push flows unchanged; they already rely on mobile-safe Obsidian APIs.

### Scope (In/Out)

- In: Settings tab refactor for platform-aware rendering; lazy Electron imports; mobile-safe
  initialization; manual token entry on mobile; ensuring desktop token continues syncing via
  Obsidian settings data.
- Out: Building a new mobile OAuth flow; background service reliability improvements on mobile;
  bundle-size optimization beyond reasonable hygiene.

## Context for Development

### Codebase Patterns

- Obsidian plugin with esbuild bundling; externals include `obsidian`, `electron`.
- Path aliases via tsconfig (`@app/*`, `@ui/*`, etc.).
- Settings tab registered in `src/app/main.ts`; token wizard in
  `src/ui/settings/KeepSidianSettingsTab.ts`; desktop-only token wizard in
  `src/integrations/google/keepTokenDesktop.ts`.
- Platform detection available from `Platform` in `obsidian`.

### Files to Reference

- `src/app/main.ts` — registers settings tab.
- `src/ui/settings/KeepSidianSettingsTab.ts` — settings UI + token wizard.
- `src/integrations/google/keepToken.ts` — shared (mobile-safe) token exchange export.
- `src/integrations/google/keepTokenExchange.ts` — token exchange implementation.
- `src/integrations/google/keepTokenDesktop.ts` — desktop-only Electron webview OAuth flow.
- `src/integrations/google/keepTokenDesktopLoader.ts` — desktop module loader.
- `esbuild.config.mjs` — bundling config (externalizes `electron`).
- `docs/02-research/mobile-compatibility.md` — prior findings.

### Technical Decisions

- Use `Platform.isDesktopApp` / `Platform.isMobileApp` from Obsidian to branch UI/flows.
- Keep token retrieval wizard desktop-only; on mobile, hide the button and surface manual token
  input.
- Produce a second bundle (`keepTokenDesktop.js`) that contains all Electron webview logic; keep
  `main.js` free of `require("electron")` and desktop-only wizard internals.

## Implementation Plan

### Tasks

- [x] Use `Platform` to branch desktop/mobile behavior.
- [x] Update `KeepSidianSettingsTab`:
  - [x] Render token retrieval wizard UI only when `Platform.isDesktopApp` is true.
  - [x] Ensure manual token text field is always available; add mobile-specific hint.
  - [x] Only load token wizard code on desktop click via a loader (`keepTokenDesktopLoader`).
- [x] Split token logic:
  - [x] Keep mobile-safe exchange code in `keepTokenExchange.ts` and re-export from `keepToken.ts`.
  - [x] Move Electron/webview wizard logic to `keepTokenDesktop.ts`.
  - [x] Ensure `main.js` contains no `require("electron")` (desktop code lives in `keepTokenDesktop.js`).
- [x] Build/release plumbing:
  - [x] Update `esbuild.config.mjs` to build `main.js` and `keepTokenDesktop.js`.
  - [x] Update `.github/workflows/release.yml` to ship `keepTokenDesktop.js` with releases.
- [x] Optional: add mobile notice text (wizard is desktop-only).
- [x] Tests:
  - [x] Add tests for mobile guard paths and desktop loader usage.
  - [x] Re-run Jest suites for settings and token logic.

### Acceptance Criteria

- [ ] Plugin loads without errors on Obsidian Mobile (iOS/Android) with Electron unavailable.
- [ ] Settings view renders on mobile; sync token field editable; no token wizard button shown on
      mobile.
- [ ] Desktop behavior unchanged: token wizard works via Electron webview; settings tab still
      renders.
- [ ] Sync/push flows operate on mobile when a token is present (manually set or synced from
      desktop).
- [x] Main bundle safety: `main.js` contains no `require("electron")` (desktop-only logic is in
      `keepTokenDesktop.js`).

## Additional Context

### Dependencies

- Obsidian `Platform` API.
- Existing server endpoints unchanged.

### Testing Strategy

- Unit: mock `Platform.isMobileApp` to verify desktop-only branches are skipped; ensure no Electron
  require is called.
- Manual:
  - Desktop: run token wizard and sync.
  - Mobile: install plugin build, open settings, confirm no crash, paste token, run sync/push.

### Notes

- Background sync timers may still be throttled on mobile; out of scope for this change.

## Dev Agent Record

### File List

- `esbuild.config.mjs`
- `.github/workflows/release.yml`
- `src/ui/settings/KeepSidianSettingsTab.ts`
- `src/ui/settings/tests/KeepSidianSettingsTab.test.ts`
- `src/ui/settings/tests/KeepSidianSettingsTab.ui.test.ts`
- `src/integrations/google/keepToken.ts`
- `src/integrations/google/keepTokenExchange.ts`
- `src/integrations/google/keepTokenDesktop.ts`
- `src/integrations/google/keepTokenDesktopLoader.ts`
- `src/integrations/google/tests/keepToken.test.ts`

### Test Summary

- `npm test -- src/ui/settings/tests/KeepSidianSettingsTab.test.ts`
- `npm test -- src/ui/settings/tests/KeepSidianSettingsTab.ui.test.ts`
- `npm test -- src/integrations/google/tests/keepToken.test.ts`

### Build/Lint Summary

- `npm run lint:ts`
- `npm run lint:md`
- `npm run build`
