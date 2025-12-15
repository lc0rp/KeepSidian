# KeepSidian: 2-way Obsidian-Google Keep sync

[![License](https://img.shields.io/github/license/lc0rp/KeepSidian?style=flat-square)](LICENSE)
[![Issues](https://img.shields.io/github/issues/lc0rp/KeepSidian?style=flat-square)](https://github.com/lc0rp/KeepSidian/issues)
[![Release](https://img.shields.io/github/v/release/lc0rp/KeepSidian?style=flat-square)](https://github.com/lc0rp/KeepSidian/releases)
[![Downloads](https://img.shields.io/github/downloads/lc0rp/KeepSidian/total?style=flat-square)](https://github.com/lc0rp/KeepSidian/releases)

> ⚠️ **Note**: Not affiliated with the Android app Capsidian (Formerly "Keepsidian").
> For Android app questions, please see
> [👉 this thread](https://forum.obsidian.md/t/app-keepsidian/101491/15).

As a regular user of both Google Keep and Obsidian, I set out to make it easier to
exchange data between both apps.

This plugin supports syncing between Google Keep and Obsidian, on-demand or
automatically on a schedule.

- Versions 1.1.2+: Introducing two-way sync!
- Versions 1.1.1 and below: Only downloading supported

Please share your feedback in the
[issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.

## Developer documentation

Maintainer-focused documentation lives in `docs/` (start at [`docs/README.md`](./docs/README.md)).

## KIM based sync server

The connection to Google Keep is established through a flask server based on
[Keep-It-Markdown](https://github.com/djsudduth/keep-it-markdown), which handles
the heavy lifting. This is particularly useful for users who cannot run Python
scripts on their computers.

When you start a sync, you will provide your Google Keep email and a token
generated during installation. These credentials are stored on your computer,
sent when you sync, and then discarded - We do not log or store your
credentials or notes in any way.

## Sync commands

KeepSidian now ships with three commands that share the same progress UI and log
output:

- **Perform two-way sync** (v1.1.2+) executes a download first and then runs the upload
  command so that newly downloaded notes are merged back to Google Keep without
  re-running the workflows manually.

- **Download notes from Google Keep** downloads notes from Google Keep into the
  configured vault folder. It remembers the last successful sync date and only
  downloads notes that have been updated since then.

- **Upload notes to Google Keep** (v1.1.2+) scans the sync folder for Markdown files whose
  `KeepSidianLastSyncedDate` is older than the file's modified timestamp,
  bundles any attachments in the `media/` folder that have been updated since
  the last push, and sends the payload to Google Keep.
  > **Note**: Uploads are gated behind opt-in safeguards in settings and may require an active subscription.
  > Attachments referenced from the note and located under `media/` are included in the upload payload; server support
  > may vary by attachment type.

- **Open sync log file** opens the most recent log file in a new pane.

When a sync is running you'll see a persistent toast and a status bar indicator
showing progress. Hovering over the status bar shows a tooltip identifying it as
KeepSidian sync progress, and clicking the status bar opens a dialog with a
progress bar and stats about the current sync.

## Activity log (v1.1.0+)

Each sync activitiy is recorded in a time stamped activity log file under
`_KeepSidianLogs/` in the target directory as Markdown list items. This file is
rotated daily.

## Background sync (v1.0.7+)

You can enable background syncing on a 24 hour schedule by
default. Project supporters can customize the interval in hours.
Project supporters can also choose to run a two-way sync whenever background syncing.

When background-sync is enabled, a status bar indicator is shown in the bottom right.

## Supporting the project

KeepSidian is useful for all users. However, some advanced features that may incur
additional processing, third party costs or developer time shall be released to
users who choose to support KeepSidian development. Anyone can choose to support
the project here:
[🌎 Support KeepSidian](https://keepsidianserver-v2-162887264002.us-central1.run.app/subscribe).

### Exclusive supporter features

v1.0.14:

- Advanced filters
- Auto-tagging
- Contextual title generation

v1.1.0:

- Granular background sync interval below the default 24 hours.

v1.1.2:

- Two-way background sync

## Future roadmap

Some upcoming features that I plan to work on include:

- Daily sync (Shipped in v1.1.0)
- Realtime sync
- Archiving
- Downloading Archived Notes
- Unlimited notes (Shipped in v1.0.14)
- 2-way sync (Shipped in v1.1.2)
- Advanced filters (Shipped in v1.0.14 to supporters)
- Auto-tagging (Shipped in v1.0.14 to supporters)
- Contextual title generation (Shipped in v1.0.14 to supporters)

> **What would you like to see next?**
>
> Please rank the upcoming features here or add your own!
>
> 1. [KeepSidian wishlist](https://umh39lhux3j.typeform.com/to/NKbRukRg) - Google
> keep features.
>
> 2. [Google Calendar features](https://umh39lhux3j.typeform.com/to/WuDedfWN)
> (coming soon): I'd love to hear what you want for this feature.

## Installation

KeepSidian can be installed from the
[community plugin store](https://obsidian.md/plugins?id=keepsidian), as well as a
few other options outlined below.

### Get the plugin

- **Option 1 (Preferred)**: Via the
  [Obsidian community plugin store](https://obsidian.md/plugins?id=keepsidian)
- **Option 2**: Use the
  [Obsidian BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
- **Option 3**: Clone this repository in your
  {obsidian vault path}/.obsidian/plugins

After installation, go to "Settings > Community Plugins > KeepSidian" in Obsidian to configure the plugin.

### Configure

In the plugin settings, you will need to provide:

- Enter your Google Keep email.
- Enter the folder to sync to (relative to your vault). The folder is created
  automatically if it doesn't exist.
- Enable/disable automatic syncing.

### Retrieve a Google Keep token

Click "Retrieve Token," and a browser window should open, prompting you to log
into Google. Once you have done so, we shall generate a token that will be used
to access your Google Keep account.

**PRIVACY NOTE**: THIS TOKEN IS ONLY STORED ON YOUR COMPUTER.

## Frontmatter

The plugin adds the following frontmatter to each synced note:

- GoogleKeepUrl
- GoogleKeepCreatedDate
- GoogleKeepUpdatedDate
- KeepSidianLastSyncedDate

## Conflict resolution

When a local note and its Google Keep counterpart have both been modified since
the last sync, KeepSidian now attempts to merge the differing bodies of the
notes. The frontmatter of the existing note is preserved and excluded from the
merge comparison. If the merge succeeds, the note is updated in place;
otherwise, the incoming version is saved as a separate `-conflict-<timestamp>.md`
file.

## Other plugins

- [Obsidian Task Roles](https://github.com/lc0rp/obsidian-task-roles/) - Assignee & Role Tracking for your Obsidian Tasks.
- [Checkbox Bulk Dates](https://github.com/lc0rp/obsidian-checkbox-bulk-dates) - Add creation dates to unchecked checkboxes.

## Feedback

Please share your feedback in the [issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.
