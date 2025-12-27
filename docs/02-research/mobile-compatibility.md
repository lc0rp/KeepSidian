# KeepSidian Mobile Compatibility Report (2025-12-17, updated 2025-12-27)

## TL;DR

- The plugin now loads on Obsidian Mobile after moving Electron-only wizard code into a desktop
  bundle.
- Token retrieval now uses Playwright/Puppeteer browser automation on desktop; mobile users must
  paste a token captured on desktop.
- Core sync logic (pull/push via `requestUrl` + vault adapter) is mobile-friendly once a token is
  present.

## Status update (2025-12-27)

- Browser automation now ships in `keepTokenBrowserAutomationDesktop.js` and is launched on demand
  from settings (Playwright or Puppeteer).
- Settings UI hides the retrieval wizard on mobile and allows manual token entry.
- Build verification now ensures `main.js` ships without Electron `require` paths.

## Desktop‑only blockers (current)

- Browser automation depends on Node/Electron modules and Playwright/Puppeteer, which are not
  available in the mobile runtime.
- Launching and controlling a real browser window is a desktop-only capability.

## Legacy desktop‑only blockers (2025-12-17 webview flow)

- `src/app/main.ts` instantiates `KeepSidianSettingsTab`, which imports `electron` at module load.
  Obsidian Mobile ships without the Electron runtime, so the `require("electron")` call throws
  before the plugin can load.
- `src/ui/settings/KeepSidianSettingsTab.ts:1-40,240-310` depends on `WebviewTag` and creates
  `<webview>` elements for the token wizard. `<webview>` and the related event/model APIs exist only
  in Electron.
- `src/integrations/google/keepToken.ts` is built around Electron’s `WebviewTag`, `webRequest`,
  `session.cookies`, `executeJavaScript`, and `insertCSS`. These APIs have no equivalents on mobile,
  so the OAuth/token wizard cannot function.
- Because esbuild marks `electron` as external (`esbuild.config.mjs`), the runtime
  `require("electron")` is preserved, guaranteeing a load-time failure on mobile rather than lazy
  failure.

## What should still work on mobile (if the Electron bits are gated)

- Sync pull: uses Obsidian’s `requestUrl` and vault adapter writes in `src/features/keep/sync.ts`
  and `src/features/keep/io/attachments.ts`; these APIs are supported on mobile.
- Two-way/push: uses `requestUrl` + `vault.adapter.read/write` and `arrayBufferToBase64`
  (`src/features/keep/push.ts`); these are part of the mobile API surface.
- Progress UI/Notices: built with standard Obsidian components (`Notice`, `StatusBar`, modals) which
  are available on mobile.

## Caveats & edge cases

- Without the desktop token wizard, mobile users must paste a valid Keep token manually into
  settings; the retrieval wizard is hidden on mobile.
- Default server URL is injected at build time; ensure production builds use the hosted endpoint, as
  `localhost` is unreachable from mobile devices.
- Background sync relies on timers (`setInterval`) and network availability; on iOS/Android, the app
  must stay foregrounded for timers to run reliably.
- The browser automation bundle includes Playwright/Puppeteer dependencies and increases release
  size; it should remain desktop-only and not load on mobile.

## Quick mitigation ideas (implemented)

- Gate all Electron imports and the settings tab token wizard behind `Platform.isDesktopApp`; load a
  simplified settings view on mobile that only accepts manual token input.
- Defer loading `keepToken` until the user clicks “Retrieve token,” and skip rendering the
  `<webview>` entirely on mobile.
- Add a runtime guard in `onload` to avoid registering the desktop-only settings tab on mobile
  builds.
