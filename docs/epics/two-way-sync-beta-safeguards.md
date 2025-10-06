# Two-Way Sync Beta Safeguards – Brownfield Enhancement

## Project Analysis

### Existing Project Context

- Project purpose and current functionality understood — KeepSidian currently performs one-way imports from Google Keep, with commands and UI affordances already stubbed for push/two-way flows.
- Existing technology stack identified — Obsidian plugin built with TypeScript, Obsidian API, local settings persistence, premium gating via subscription service.
- Current architecture patterns noted — Layered structure (app, ui, features, services), settings rendered via `KeepSidianSettingsTab`, commands registered in `@app/commands`, sync orchestrated in `@features/keep/sync`.
- Integration points identified — Settings UI → `KeepsidianPlugin` settings model, commands ("Upload to Google Keep", "Perform two-way sync"), status bar menu, progress modal, auto-sync flow invoking sync service.
- Development environment documented — Node.js v23.9.0+, latest Obsidian desktop install, dependencies via `npm install`, project-supplied `.env.development` for local configuration; no additional env vars required.
- Linting and test pipeline referenced — `npm run lint`, `npm run lint:ts`, `npm run lint:md`, and `npm run test` defined in `package.json` as the current CI guardrail.
- Dependency footprint confirmed — no new npm packages expected; rely on existing Obsidian API surface and current project dependencies.

### Enhancement Scope

- Enhancement clearly defined and scoped — Introduce gated settings controlling exposure/use of two-way sync capabilities.
- Impact on existing functionality assessed — Must ensure non-two-way sync continues unaffected; new gating prevents accidental uploads.
- Required integration points identified — Plugin settings defaults, command enablement guards, status bar toolkit, modal buttons, auto-sync behavior, premium checks.
- Success criteria established — Two-way capabilities only usable when user explicitly acknowledges backups + enables beta toggle; auto-sync upgrades when premium users opt in; otherwise safe warnings.

## Epic Overview

### Epic Goal

Deliver a guarded beta experience that keeps upload/two-way sync features disabled until users confirm backups and explicitly opt in, ensuring safety while enabling power users to trial two-way sync reliably.

### Epic Description

**Existing System Context**

- Current relevant functionality: KeepSidian fetches Google Keep notes into the vault via manual commands, status bar menu, and auto-sync; upload/two-way operations exist but need tighter control.
- Technology stack: Obsidian plugin written in TypeScript with Prettier/ESLint, settings rendered through `KeepSidianSettingsTab`, sync handled by feature layer services.
- Integration points: Plugin settings schema/defaults, commands registered in `src/app/commands.ts`, status bar menu/actions in `src/app/sync-ui.ts`, progress modal controls in `src/ui/modals`, auto-sync timer in `src/main.ts`, subscription gating in `@services/subscription`.
- Operational context: CI uses repository lint/test scripts; server-side components run on a Flask service hosted in Google Cloud with logs monitored there; releases surfaced through Obsidian community channels.

**Enhancement Details**

- What's being added/changed: A new "Enable two-way sync (beta)" settings section with three toggles (backup acknowledgement, enable two-way sync, enable two-way sync for auto-sync) and accompanying gating logic across UI surfaces.
- How it integrates: Settings persist through existing settings model; runtime checks guard command execution, menu/button states, and auto-sync behavior, leveraging existing subscription and auto-sync flags.
- Success criteria: Users who have not acknowledged backups cannot trigger push/two-way operations; eligible users who opt in regain full functionality; premium users can upgrade auto-sync to two-way when all prerequisites met.
- Quality gates: CI runs `npm run lint` and `npm run test` on every merge; story work should add targeted unit coverage for new gating logic, and we will draft an Obsidian-driven e2e smoke plan (likely Playwright + Obsidian sandbox vault) to regression-test upload flows before graduation from beta.
- Release workflow: Package with `npm run build`, bump/version via `npm run version`, and publish using the `npm run release` script (backs scripts/release.mjs) that pushes the manifest + bundle to the Obsidian community listing; record release artifacts in the changelog before announcement.

### Stories

1. **Settings Section & Defaults** — Add "Enable two-way sync (beta)" section under Auto Sync with three toggles, persistence defaults, premium lock icon for auto-sync toggle, and dynamic enablement logic tied to backup acknowledgement, premium status, and auto-sync flag.
2. **Command & UI Safety Gates** — Gate `Upload to Google Keep` and `Perform two-way sync` commands, status bar menu items, and progress modal buttons; show notices guiding users to settings (deep-link if possible) when prerequisites unmet.
3. **Auto-Sync Upgrade Path** — When user is premium and all three toggles satisfied, update auto-sync flow to perform two-way sync; otherwise retain existing download-only behavior.

### Compatibility Requirements

- Existing APIs remain unchanged.
- Database schema changes are backward compatible.
- UI changes follow existing patterns.
- Performance impact is minimal.

### Risk Mitigation

- **Primary Risk:** Users unintentionally triggering uploads and overwriting cloud data without backups.
- **Mitigation:** Mandatory backup acknowledgement toggle, disabled controls until opt-in, informative notices that direct users to settings.
- **Rollback Plan:** Disable beta toggles in settings to immediately revert behavior to download-only without reloading the plugin.
- **Operational Rollback:** If field issues surface, hide the beta release, re-publish the previous stable build, and post an announcement in the public Discord channels to keep users informed.
- **Monitoring:** Observe the Google Cloud Flask server logs for elevated error rates or abnormal two-way sync traffic during the beta window; escalate through existing on-call channels when anomalies appear.
- **Regression Strategy:** Preserve download-only flows through unit coverage around sync orchestration and manual smoke passes in Obsidian before each release; add scripted e2e coverage once tooling is selected to prevent command regressions.
- **Communication Plan:** Announce beta availability, safeguards, and any incidents through the Obsidian Discord channels; coordinate messaging with support so they can coach users on re-enabling download-only mode if required.
- **Release Guardrail:** Execute `npm run build`, `npm run version`, and `npm run release` in that order; maintain the release checklist (smoke results, manifest/main.js parity, Discord copy) in the repo’s release notes for accountability.
- **Failure Handling:** When the Flask API returns HTTP 429 (Google Keep throttle), surface a Notice instructing the user to wait a few minutes before retrying and back off programmatically with exponential delays (capped around 5 minutes) before surfacing the error; for other 4xx/5xx responses, display a Notice indicating sync is temporarily unavailable, log the response payload for diagnostics, and keep download-only fallback accessible while monitoring resolves the incident.

### Definition of Done

- All stories completed with acceptance criteria met.
- Existing functionality verified through testing.
- Integration points working correctly.
- Documentation updated appropriately (settings help, release notes).
- No regression in existing features (manual download, auto-sync download).
- CI checks (`npm run lint`, `npm run test`) green; manual smoke across command/status bar/modal flows recorded; decision log updated with e2e testing approach and rollout communications sent.
- Release checklist completed (build/version/release scripts run, manifest/main.js checksum verified, smoke log attached, Discord announcement scheduled).

### Operational Runbook

- **Accessibility & UX:** Document high-contrast/keyboard focus behavior for the new toggles; include acceptance criteria around tab order, focus rings, and Notice copy for error states in status bar/menu/modal surfaces before stories close.
- **Manual Regression Checklist:** Prior to each release run through (1) import-only sync via command, (2) upload/two-way commands with gating permutations, (3) status bar trigger, (4) auto-sync timer with and without beta toggles, and (5) attachment download sanity.
- **E2E Automation Plan:** Prototype Playwright scripts (dependency already available) that launch Obsidian against a sandbox vault; target coverage for enabling toggles, performing guarded upload, and reverting to download-only; graduate to mandatory once stable.
- **Credential & Monitoring Ownership:** Maintainer (Luke) owns Google Cloud log review after release; server anomalies escalate to the on-call channel with root cause notes added to the release checklist.
- **Support & Comms Playbook:** Support lead drafts Discord announcement using the communication template; if incidents occur, push guidance on disabling beta toggles and link to rollback instructions; capture FAQs in docs/help after each wave.
- **Role Assignment:** PO maintains the checklist/documentation, dev lead implements gating/tests and validates automation, support handles Discord messaging and user escalations, QA partner reviews regression evidence before release sign-off.

### Decision Log

- **E2E tooling selection – Adopt Playwright + sandbox vault harness**
    - **Context:** We need automated regression cover for the beta safeguards so that command/menu toggles and guarded auto-sync can be exercised before each release without relying solely on manual Obsidian runs.
    - **Decision:** Use Playwright's Electron runner to launch a portable Obsidian binary against a dedicated sandbox vault that we clone per test run. The harness lives under `tests/e2e` with a `vault-template` folder containing a minimal KeepSidian vault state.
    - **Rationale:** Playwright gives first-class Electron automation (keyboard, vault file assertions, network interception) while remaining actively maintained; legacy options like Spectron are unmaintained, and pure unit tests cannot validate UI wiring or Obsidian lifecycle hooks. A throwaway vault keeps user data isolated and lets us pre-configure `.obsidian/plugins` with the built plugin + settings toggles needed for each scenario.
    - **Implementation Notes:**
        - Add `npm run test:e2e` that builds the plugin, copies `tests/e2e/vault-template` into a tmp directory, installs the compiled plugin, and launches Playwright's Electron runner pointing at the local Obsidian binary (path configurable via env, defaulting to `/Applications/Obsidian.app` on macOS).
        - Stub Google Keep API calls inside tests using Playwright's `page.route` or a lightweight mock server fixture so the suite remains deterministic/offline.
        - Scope coverage to smoke scenarios (toggle gating, command notices, auto-sync upgrade path) to keep runtime acceptable; CI can run on macOS runners only, with other platforms opting in locally.
    - **Follow-ups:** Document how to supply the Obsidian binary path cross-platform, wire the optional job into CI once macOS runners are provisioned, and expand the sandbox vault fixtures as new beta surfaces emerge.

## Validation Checklist

### Scope Validation

- Epic can be completed in 1–3 stories maximum.
- No architectural documentation is required.
- Enhancement follows existing patterns.
- Integration complexity is manageable.
- Post-MVP roadmap acknowledged — finalize documentation uplift, extend test coverage (including e2e exploration), and graduate the feature out of beta naming once stability confirmed.

### Risk Assessment

- Risk to existing system is low.
- Rollback plan is feasible.
- Testing approach covers existing functionality (unit + manual smoke for commands/UI).
- Team has sufficient knowledge of integration points.

### Completeness Check

- Epic goal is clear and achievable.
- Stories are properly scoped.
- Success criteria are measurable.
- Dependencies are identified.

### Checklist Results (2025-10-05)

- Product Owner master checklist re-run after operational updates: ~90% pass (112/124)
- Decision: GO — brownfield w/ UI safeguards ready for story handoff
- Outstanding follow-ups: prototype Playwright e2e suite, finalize Discord announcement template, capture post-release smoke evidence per operational runbook

## Story Manager Handoff

Please develop detailed user stories for this brownfield epic. Key considerations:

- This is an enhancement to an existing TypeScript-based Obsidian plugin (KeepSidian) that already supports download sync but needs safer handling of two-way features.
- Integration points: plugin settings model/UI (`KeepSidianSettingsTab`), command registration (`@app/commands`), status bar menu + progress modal (`@app/sync-ui`, `@ui` modals), auto-sync orchestration (`src/main.ts`), premium/subscription checks.
- Existing patterns to follow: settings gating conventions with lock icons for premium features, command guard helpers that surface `Notice` messages, UI state toggles in status bar and modal components.
- Critical compatibility requirements: no breaking changes to existing download workflow, commands remain registered but safely short-circuit, performance impact negligible.
- Each story must ensure existing download-only sync paths remain functional and properly tested.

The epic should maintain system integrity while delivering a safe, opt-in two-way sync beta experience.
