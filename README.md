# KeepSidian

> ⚠️ **Note**: Not affiliated with the Android app Capsidian (Formerly "Keepsidian").
> For Android app questions, please see
> [👉 this thread](https://forum.obsidian.md/t/app-keepsidian/101491/15).

Two-way sync between Google Keep and Obsidian.

As a regular user of both Google Keep and Obsidian, I set out to make it easier to
exchange data between both apps.

This plugin supports syncing between Google Keep and Obsidian, on-demand or
automatically on a schedule.
- Versions 1.1.1 and below: Only downloading supported
- Versions 1.1.2+: Two-way sync supported

Note: Two-way sync was introduced in version 1.1.2.

Please share your feedback in the
[issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.

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
  > **Note**: that attachments and media files are not currently supported.

- **Open sync log file** opens the most recent log file in a new pane.

When a sync is running you'll see a persistent toast and a status bar indicator
showing progress. Hovering over the status bar shows a tooltip identifying it as
KeepSidian sync progress, and clicking the status bar opens a dialog with a
progress bar and stats about the current sync.

## Activity log (v1.1.0+)

Each sync activitiy is recorded in a time stamped activity log file under
`_KeepSidianLogs/` in the target directory as Markdown list items. This file is
rotated daily.

## Auto sync (v1.0.7+)

In plugin settings, you can enable automatic syncing on a 24 hour schedule by
default. Subscribers can customize the interval in hours. If two-way sync is enabled,
subscribers can also choose to run a two-way sync whenever auto-syncing.

When auto-sync is enabled, a status bar indicator is shown in the bottom right

Notes about save location and logging:

- If the save location and log files cannot be created (e.g., permissions or
  invalid name), an error is shown and the sync does not start.

## Features

> **Please rank the upcoming features here!**
>
> 1. [KeepSidian wishlist](https://umh39lhux3j.typeform.com/to/NKbRukRg) - Google keep features.
>
> 2. [Google Calendar features](https://umh39lhux3j.typeform.com/to/WuDedfWN)
> (coming soon): I'd love to hear what you want for this feature.

### Subscriber features

I intend to make most features available to all users, however, some features
may incur additional processing, third party costs or developer time. Those
shall be released to subscribers.

v1.0.14 subscriber features:

- Advanced filters
- Auto-tagging
- Contextual title generation

v1.1.0 subscriber features:

- Granular auto-sync interval below the default 24 hours.

v1.1.2 subscriber features:

- Two-way sync during auto-sync.

### Future roadmap

If more people find this project useful, I may expand the functionality to
include the following features. I'll endevour to atures that can increase cost
significantly will be made available to

- Daily sync (Shipped in v1.1.0)
- Realtime sync
- Archiving
- Downloading Archived Notes
- Unlimited notes (Shipped in v1.0.14)
- 2-way sync
- Advanced filters (Shipped in v1.0.14 to Subscribers)
- Auto-tagging (Shipped in v1.0.14 to Subscribers)
- Contextual title generation (Shipped in v1.0.14 to Subscribers)

> **Me again! Please rank the upcoming features here!**
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

After installation, go to "Settings > Community Plugins > KeepSidian" in Obsidian.

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
