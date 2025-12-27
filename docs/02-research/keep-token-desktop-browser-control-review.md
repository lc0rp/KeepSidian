# Research: Google Login Browser Control vs KeepSidian Desktop Flow

Created: 2025-12-20 Source: "Controlling a Browser for Google Login in an Obsidian Plugin.pdf"

## Summary

The PDF outlines multiple approaches for Google login and cookie access in Obsidian: embedded webview (Custom Frames /
Web Viewer), external browser OAuth redirect, Electron BrowserWindow, automation via Puppeteer/Playwright, and OS-level
automation. KeepSidian originally used an embedded Electron webview inside the settings tab and then tried to extract
the "oauth_token" cookie via Electron session APIs and webRequest headers, with a manual DevTools fallback. As of
2025-12-27, KeepSidian instead uses Playwright/Puppeteer automation to drive a real browser and capture the cookie.
The legacy embedded-webview approach aligned with the PDF’s webview guidance but still faced Google’s embedded-webview
restrictions, which could prevent the cookie from ever being set.

## Status update (2025-12-27)

KeepSidian now uses Playwright/Puppeteer browser automation launched from settings to drive a real browser window,
overlay step-by-step instructions, and capture the OAuth cookie. The legacy embedded webview approach has been
de-emphasized in favor of this more reliable automation flow.

## Current KeepSidian desktop approach (browser automation)

- Launches a real browser via Playwright or Puppeteer from the settings tab.
- Injects on-page overlays to guide the user through sign-in and 2FA steps.
- Reads the OAuth cookie from the browser context and exchanges it for a long-lived keep token.
- Ships in the desktop-only `keepTokenBrowserAutomationDesktop.js` bundle.

## What the PDF recommends (highlights)

- Avoid iframes: Obsidian's iframe contexts block cookies by default, so use a webview-based approach (Custom Frames or
  core Web Viewer) that allows cookies and makes them accessible to plugins.
- Prefer external OAuth flow if possible: use system browser + redirect capture to avoid embedded-webview blocking.
- If staying embedded: use Electron session cookies API to read cookies from the webview's session.
- Provide fallbacks for cases where Google blocks embedded login.

## Legacy KeepSidian desktop approach (keepTokenDesktop.ts, pre-2025-12-27)

- Creates a <webview> element in the settings tab (desktop-only), with:
  - `partition="persist:keepsidian"`
  - `disablewebsecurity`, `allowpopups`, `disableblinkfeatures="AutomationControlled"`
- Loads `https://accounts.google.com/EmbeddedSetup`.
- Attempts automatic token retrieval via:
  - `session.fromPartition(partition).cookies.get(...)` with filters for oauth_token.
  - `session.webRequest.onHeadersReceived` to detect Set-Cookie headers for oauth_token.
  - `cookies.on('changed', ...)` watcher for oauth_token cookie.
- Falls back to opening DevTools and instructing the user to manually copy the oauth_token cookie.

## Comparison with PDF approaches

1. Embedded webview approach (Custom Frames / Web Viewer)

- Similarity: legacy KeepSidian used a webview tag and Electron session APIs to read cookies.
- Difference: the current flow no longer relies on a custom embedded webview in settings.

1. External browser OAuth redirect

- KeepSidian uses an external, real browser via automation, but does not rely on a redirect callback flow.

1. Electron BrowserWindow

- KeepSidian does not open a dedicated BrowserWindow; it launches a real browser via automation. The PDF treats
  BrowserWindow as a viable alternative for better control and session access.

1. Automation tooling (Puppeteer/Playwright)

- KeepSidian now uses automation via Playwright/Puppeteer to drive a real browser and capture cookies.

## Answers to the requested questions

1. Are we using a technique similar to the "Custom Frames" plugin? Are we using the latest "Obsidian Web Viewer"
   features?
    - Similar technique: yes, we use an Electron webview and attempt to read cookies via the webview's session, which is
      the same broad approach described for Custom Frames / Web Viewer.
    - Web Viewer features: no. We are not using the core Web Viewer view or its APIs; we build a custom webview in the
      settings tab.

2. The document mentions `session.cookies.get({ url: "https://accounts.google.com" })`. Why doesn't this work for us?
   Likely causes, based on current code:
    - Google may block embedded-webview logins or alter the flow, so the oauth_token cookie never gets set.
    - The cookie name might not actually be `oauth_token` in the flow being used (the code only checks that cookie).
    - Session mismatch: if the webview is not actually using the same partition being queried (or if Electron's session
      APIs are unavailable in the plugin runtime), `session.fromPartition(...).cookies.get(...)` will not see the
      cookie.
    - Timing: the cookie may be set after polling stops, or in a popup window spawned during consent, which may have a
      different session partition.

3. Are we using the latest Obsidian APIs?
    - The flow is mostly using low-level Electron APIs (`WebviewTag`, `session.cookies`, `webRequest`) rather than
      Obsidian-specific APIs. This is valid but not a "latest Obsidian API" pattern; Obsidian's docs focus on view
      registration and workspace APIs, not webview construction. The core Web Viewer is documented as a plugin with
      cookie access, but we do not use it.

4. Anything else we can do to improve keepTokenRetrieval?
    - Add an external OAuth redirect flow as a primary or fallback path to avoid Google embedded-webview blocking.
    - Consider using a dedicated BrowserWindow (Electron) instead of a webview in settings; it may have more predictable
      session behavior.
    - If keeping the webview, explicitly set the user-agent to remove "Electron" branding and reduce Google blocking.
    - Improve observability: log (redacted) cookie counts, session partition, and whether webRequest handlers attach.
    - Expand detection to alternative cookie names or other signals if Google no longer sets `oauth_token`.

## Notable gaps vs PDF recommendations

- No external OAuth redirect fallback.
- No use of the core Web Viewer view (which is documented to provide cookie access).
- Reliance on a single cookie name, which may be brittle if Google changes the flow.
