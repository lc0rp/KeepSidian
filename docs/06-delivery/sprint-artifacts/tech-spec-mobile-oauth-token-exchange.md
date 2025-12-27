# Tech-Spec: Mobile OAuth Token Exchange

**Created:** 2025-12-20  
**Status:** Implemented (2025-12-27)

## Overview

### Problem Statement

On desktop, the retrieval wizard always exchanges the short-lived Google Keep OAuth token for a long-lived keep token
via the server. Historically, outside the wizard exchange only happened on a `paste` event if the token contained
`oauth2_4`. On mobile, paste events are unreliable and a user may type or paste a short-lived token without triggering
the exchange, so the plugin stored the OAuth token directly. This caused tokens to expire and sync to fail.

### Solution

Trigger OAuth token exchange from the token input on change so it runs on both desktop and mobile whenever the token is
updated. If the token starts with `oauth2_4`, attempt to exchange it via the server. On failure, surface the error and
leave the token unchanged.

## Status update (2025-12-27)

- The token input `onChange` path now detects `oauth2_4` tokens and calls `exchangeOauthToken` on both desktop and
  mobile.
- `exchangeOauthToken` now guards against non-`oauth2_4` tokens.
- E2E coverage exists for both desktop and mobile change-driven exchange.
- Failed-token prefixing and centralized `saveSettings` hooks remain deferred.

### Scope (In/Out)

#### In scope

- Trigger exchange when settings are persisted and the token starts with `oauth2_4`.
- Enforce email validation before attempting exchange.
- Persist a failed marker to prevent repeated attempts on the same token.
- Update relevant tests.

#### Out of scope

- Changes to server exchange behavior or endpoint contracts.
- Changes to token retrieval wizard UX flow beyond relying on the lower-level exchange.
- Any changes to Google authentication flows outside token exchange.

## Context for Development

### Codebase Patterns

- Obsidian plugin, TypeScript, settings persisted via `KeepSidianPlugin.saveSettings()` in `src/app/main.ts`.
- Token exchange is handled by `exchangeOauthToken` in `src/integrations/google/keepTokenExchange.ts`, which POSTs to
  `${KEEPSIDIAN_SERVER_URL}/register` and writes `plugin.settings.token`.
- Settings UI uses `KeepSidianSettingsTab` in `src/ui/settings/KeepSidianSettingsTab.ts`.
- Exchange is currently triggered on a `paste` handler if the token contains `oauth2_4`.

### Files to Reference

- `src/app/main.ts` (settings persistence; add centralized token exchange hook).
- `src/ui/settings/KeepSidianSettingsTab.ts` (token input, paste handler).
- `src/integrations/google/keepTokenExchange.ts` (exchange implementation).
- `src/types/keepsidian-plugin-settings.ts` (token + email settings shape).
- Tests:
  - `src/ui/settings/tests/KeepSidianSettingsTab.test.ts`
  - `src/integrations/google/tests/keepToken.test.ts`
  - `src/app/tests/main.test.ts`

### Technical Decisions

- **Detection:** treat tokens that `startsWith("oauth2_4")` as short-lived OAuth tokens.
- **Lower-level hook:** trigger exchange in the token input `onChange` handler so exchange runs on desktop and mobile.
- **Email validation:** if email is missing or invalid, the exchange call still shows a `Notice` from the server
  response; validation prior to exchange is not enforced in the input handler.
- **Failure handling:** surface a `Notice` and leave the token unchanged (no failed-prefix marker yet).
- **Reentrancy:** avoid recursion or double-exchange by using an in-memory guard (e.g., `isExchangingToken`) and/or
  a `skipTokenExchange` flag in `saveSettings` calls initiated by the exchange flow.

## Implementation Plan

### Tasks

- [x] Trigger exchange in `src/ui/settings/KeepSidianSettingsTab.ts` on token change and paste.
- [x] Guard `exchangeOauthToken` against non-`oauth2_4` tokens.
- [x] Update unit and e2e tests for change-driven exchange.
- [ ] Centralize exchange in `KeepSidianPlugin.saveSettings()` (deferred).
- [ ] Add failed-token prefixing on exchange failure (deferred).

### Acceptance Criteria

- [x] Given a token that starts with `oauth2_4`, when settings are changed on desktop or mobile, the plugin exchanges
  the token and stores the `keep_token`.
- [x] Desktop retrieval wizard continues to function and results in a stored `keep_token`.
- [ ] If exchange fails, the token is saved with a `failed` prefix and a Notice is shown, preventing repeat attempts.

## Additional Context

### Dependencies

- KeepSidian server endpoint: `${KEEPSIDIAN_SERVER_URL}/register`.

### Testing Strategy

- Unit tests for:
  - Save-time exchange success path.
  - Email invalid: save blocked + Notice.
  - Exchange failure: token prefixed with `failed` + Notice.
  - Guard prevents repeated exchange attempts.
- Re-run existing token wizard tests to ensure no regressions.

### Notes

- Avoid user-visible token leaks in logs; follow existing redaction patterns.
- Keep behavior consistent across desktop and mobile by relying on the shared save path.
