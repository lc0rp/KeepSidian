
# KeepSidian

Sync Google Keep notes to Obsidian.

As regular users of both Google Keep and Obsidian, we aim to make it easier to use both apps simultaneously by enabling simple, user-friendly data exchange.

This plugin is still in the beta phase. Please share your feedback in the[ issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.

## Sync server

The connection to Google Keep is routed via the KeepSidian sync server, which does the heavy lifting. It enables efficient, scalable operation for all note sizes across mobile and web, fast feature iteration, and advanced features like two-way syncing, AI-assisted title generation, and auto-tagging. 

> **Note**: The KeepSidian sync server is a closed-source product. The Obsidian team is being given full access to our private codebase.

### Privacy note

We do not store any notes. 

When you initiate a sync, you'll send your Google Keep email and a token that you will generate during installation. These credentials are stored on your computer, transmitted when you make a sync, and discarded afterward. 

We do not log or store your notes or credentials in any way.

## Standard operation

In standard mode, the plugin offers an on-demand "Run Keep -> Obsidian" command to download the ten most recent notes on demand. Follow the installation instructions below to try it and share your feedback.

The plugin adds the following frontmatter to each synced note:

- GoogleKeepUrl
- GoogleKeepCreatedDate
- GoogleKeepUpdatedDate
- KeepSidianLastSyncedDate

## Premium paid service (coming soon):

**NOTE**:  [You can request Premium early access here.](https://umh39lhux3j.typeform.com/to/NKbRukRg)

For advanced users, we intend to offer paid features that include the following:  

| Premium                   | Premium Plus                                                 |
| ------------------------- | ------------------------------------------------------------ |
| Daily sync                | Real-time sync                                               |
| 100 notes                 | Unlimited notes                                              |
| 2-way sync, filters, tags | Premium features + Optional AI-assisted tagging and title generation |
| Priority support          | Priority support                                             |

**NOTE**: [Request Premium early access here.](https://umh39lhux3j.typeform.com/to/NKbRukRg)

## Installation

KeepSidian is in the process of being added to the community plugin store. Until it's accepted, you can download it using the instructions below:

- **Option 1**: Use the [Obsidian BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
- **Option 2**: Clone this repository in your <obsidian vault path>/.obsidian/plugins

## Standard configuration

After installation, go to "Settings > Community Plugins > KeepSidian" in Obsidian.

### Step 1: Configure:

- Enter our Google Keep email.
- Enter the folder to sync to

### Step 2: Retrieve a Google Keep token

Click "Retrieve Token," and a browser window should open, prompting you to log into Google. Once you have done so, we shall generate a token that will be used to access your Google Keep account.

**PRIVACY NOTE**: THIS TOKEN IS ONLY STORED ON YOUR COMPUTER. 

## Feedback

Please share your feedback in the[ issues section](https://github.com/lc0rp/KeepSidian/issues) on GitHub.