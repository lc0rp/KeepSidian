
# KeepSidian

Sync Google Keep notes to Obsidian.

As a regular user of both Google Keep and Obsidian, I set out to make it easier to exchange data between both apps.

This plugin is still in the beta phase and only supports one-way download for now, from Google Keep to Obsidian. Please share your feedback in the [issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.

## KIM based sync server

The connection to Google Keep is established through a flask server based on [Keep-It-Markdown](https://github.com/djsudduth/keep-it-markdown), which handles the heavy lifting. This is particularly useful for users who cannot run Python scripts on their computers. 

When you start a sync, you will provide your Google Keep email and a token generated during installation. These credentials are stored on your computer, sent when you sync, and then discarded - We do not log or store your credentials or notes in any way.

## Sync command

This plugin offers an on-demand "Run Keep -> Obsidian" command to download the 50 most recent notes on demand. Follow the installation instructions below to try it and share your feedback. 

## Future roadmap

If more people find this project useful, I may expand the functionality to include daily sync, realtime sync, unlimited notes, 2-way sync, filters, tags or AI-enabled tagging & title generation.

Rank the upcoming features here: [KeepSidian Wishlist](https://umh39lhux3j.typeform.com/to/NKbRukRg)

## Installation

KeepSidian is in the process of being added to the community plugin store. Until it's accepted, you can download it using the instructions below:

### Get the plugin

- **Option 1**: Use the [Obsidian BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
- **Option 2**: Clone this repository in your <obsidian vault path>/.obsidian/plugins

After installation, go to "Settings > Community Plugins > KeepSidian" in Obsidian.

### Configure:

- Enter our Google Keep email.
- Enter the folder to sync to

### Retrieve a Google Keep token

Click "Retrieve Token," and a browser window should open, prompting you to log into Google. Once you have done so, we shall generate a token that will be used to access your Google Keep account.

**PRIVACY NOTE**: THIS TOKEN IS ONLY STORED ON YOUR COMPUTER. 

## Frontmatter

The plugin adds the following frontmatter to each synced note:

- GoogleKeepUrl
- GoogleKeepCreatedDate
- GoogleKeepUpdatedDate
- KeepSidianLastSyncedDate

## Feedback

Please share your feedback in the [issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.
