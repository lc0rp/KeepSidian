# Testing

## Runner

- Jest via `npm run test`
- Coverage via `npm run coverage`

## E2E (Obsidian UI)

E2E tests use WebdriverIO + `wdio-obsidian-service` (see `wdio.conf.mts` for desktop and
`wdio.mobile.conf.mts` for Android).

### Desktop (Electron)

- `npm run e2e:desktop` (build + run)
- `npm run wdio` (run without building)

### Android (real mobile app)

Prereqs:

- Android Studio installed and an Android Virtual Device (AVD) created
- Name the AVD `obsidian_test` (or set `OBSIDIAN_AVD=<name>`)
- Ensure `ANDROID_SDK_ROOT` (or `ANDROID_HOME`) is set; on macOS the default is usually
  `$HOME/Library/Android/sdk`.
- If you start Appium manually, it must run in a shell that has the Android SDK on `PATH`
  (`adb`, `emulator`, etc.).

Environment (macOS):

- `export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"`
- `export ANDROID_HOME="$ANDROID_SDK_ROOT"`
- `export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"`

Run:

- `npm run e2e:android` (build + run)
- `npm run wdio:mobile` (run without building)
- Optional: `npm run appium:android` (start Appium server with correct flags/env)

Notes:

- Appium v3 requires insecure features to be prefixed (e.g. `*:adb_shell`). Our WDIO config handles
  this.

## Structure

- Global setup: `src/tests/setup.ts` and `src/tests/setup-env.ts`
- Most unit tests live under `src/**/tests/*.test.ts`
