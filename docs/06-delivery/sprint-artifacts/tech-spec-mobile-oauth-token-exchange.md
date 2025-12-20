# Tech-Spec: Mobile OAuth Token Exchange

**Created:** 2025-12-20  
**Status:** Ready for Development

## Overview

### Problem Statement

On desktop, the retrieval wizard always exchanges the short-lived Google Keep OAuth token for a long-lived keep token
via the server. Outside the wizard, exchange only happens on a `paste` event if the token contains `oauth2_4`. On
mobile, paste events are unreliable and a user may type or paste a short-lived token without triggering the exchange,
so the plugin stores the OAuth token directly. This causes tokens to expire and sync to fail.

### Solution

Move OAuth token exchange to a lower-level save path so it runs on both desktop and mobile whenever the token is saved.
If the token starts with `oauth2_4`, attempt to exchange it via the server. On failure, mark the token as failed to
prevent reattempt loops and notify the user. If the email is missing or invalid, block saving and prompt the user.

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
- **Lower-level hook:** introduce an exchange guard inside `KeepSidianPlugin.saveSettings()` (or a helper it calls)
  so exchange runs whenever settings are persisted.
- **Email validation:** if email is missing or invalid, show a `Notice` and block the save when an OAuth token is present.
- **Failure handling:** when exchange fails, prefix the token with `failed` (e.g. `failedoauth2_4...`) and show a
  `Notice`, preventing repeated attempts on subsequent saves.
- **Reentrancy:** avoid recursion or double-exchange by using an in-memory guard (e.g., `isExchangingToken`) and/or
  a `skipTokenExchange` flag in `saveSettings` calls initiated by the exchange flow.

## Implementation Plan

### Tasks

- [ ] Add centralized token exchange handling in `src/app/main.ts`:
  - [ ] Detect OAuth token on save (`token.trim().startsWith("oauth2_4")`).
  - [ ] Validate email before exchange; show Notice and abort save if invalid.
  - [ ] Attempt exchange via `exchangeOauthToken` (refactor to allow no settings tab context if needed).
  - [ ] On failure, prefix `failed` and persist token; show Notice.
  - [ ] Add guard to prevent recursive exchange or duplicate attempts.
- [ ] Adjust settings UI behavior in `src/ui/settings/KeepSidianSettingsTab.ts`:
  - [ ] Ensure the token save path relies on the centralized exchange logic.
  - [ ] Decide whether to keep or neutralize the `paste`-based exchange to avoid double-work.
- [ ] Update tests:
  - [ ] Add unit tests for save-time exchange success/failure and email validation.
  - [ ] Update settings tab tests to reflect new lower-level behavior.
  - [ ] Update exchange tests if `exchangeOauthToken` signature changes.

### Acceptance Criteria

- [ ] Given a token that starts with `oauth2_4` and a valid email, when settings are saved on desktop or mobile,
  the plugin exchanges the token and stores the `keep_token`.
- [ ] Given a token that starts with `oauth2_4` and an invalid/missing email, the plugin shows a Notice and does not
  persist the token.
- [ ] If exchange fails, the token is saved with a `failed` prefix and a Notice is shown, preventing repeat attempts.
- [ ] Desktop retrieval wizard continues to function and results in a stored `keep_token`.

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
