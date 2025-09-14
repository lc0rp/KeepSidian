# Product Requirements Document (PRD)
## KeepSidian Obsidian Plugin - Premium Features Integration

## Overview

We are enhancing the KeepSidian Obsidian plugin by introducing "Premium Features" that offer additional functionalities to subscribed users. The plugin will now check the user's subscription status and, if active, display extra options such as two-way sync, title suggestions, tag creation, and more.

This document outlines the detailed requirements and implementation guidelines to align developers working on this project. It includes the file structure, endpoint documentation, and example code and responses for clarity.

## Table of Contents

1. [Objectives](#objectives)
2. [Functional Requirements](#functional-requirements)
   - [Subscription Status Check](#1-subscription-status-check)
   - [Plugin Settings UI Updates](#2-plugin-settings-ui-updates)
   - [Premium Features Configuration](#3-premium-features-configuration)
   - [Import Command Enhancement](#4-import-command-enhancement)
3. [File Structure](#file-structure)
4. [API Documentation](#api-documentation)
   - [/subscriber/info Endpoint](#subscriberinfo-endpoint)
5. [Implementation Details](#implementation-details)
   - [main.ts](#maints)
   - [config/index.ts](#configindexts)
   - [ui/settings](#uisettings)
   - [features/keep/sync.ts](#featureskeepsyncts)
   - [integrations/server/keepApi.ts](#integrationsserverkeepapits)
   - [types/api.ts](#typesapits-optional)
6. [Example Code and Responses](#example-code-and-responses)
7. [Notes and Considerations](#notes-and-considerations)

## Objectives

- Integrate Premium Features: Enhance the plugin to offer additional functionalities to users with an active subscription
- Subscription Management: Implement mechanisms to check and cache the user's subscription status
- User Interface Enhancements: Update the plugin settings UI to reflect premium features and subscription information
- Minimal File Creation: Structure the project to integrate new features into existing files, minimizing the addition of new files

## Functional Requirements

### 1. Subscription Status Check

- **Automatic Check**: On startup or when the cache expires, the plugin should call the /subscriber/info endpoint to verify the user's subscription status
- **Caching**:
  - Cache the subscription information locally for 24 hours
  - Invalidate the cache upon expiration or when the user's email address changes
- **Manual Refresh**:
  - Provide a "Check Subscription" option in the plugin settings to manually refresh and cache subscription info
- **Display Status**: Show the subscription status in the plugin settings UI

### 2. Plugin Settings UI Updates

- **General Premium Features Info**:
  - Display information about the premium features to all users
- **Conditional Sections**:
  - Inactive Subscribers: Show a "Why Subscribe?" section with instructions and benefits
  - Active Subscribers: Display detailed information about their subscription

### 3. Premium Features Configuration

For users with an active subscription, expose extra features in the plugin settings with toggles:

#### 3.1 Auto Sync
- **Auto Sync**:
  - Checkbox: "Auto sync"
    - Description: Automatically sync your notes at regular intervals
  - Slider: Sync Interval
    - Description: How often to sync (in hours)

#### 3.2 Filter Notes

- **Include Notes**:
  - Checkbox: "Only include notes containing"
  - Input Field: Comma-separated list of keywords
- **Exclude Notes**:
  - Checkbox: "Exclude notes containing"
  - Input Field: Comma-separated list of keywords

#### 3.3 Title Updates

- **Update Title**:
  - Checkbox: "Update title"
  - Description: The title will be updated based on the note content. The original title will be saved in the note

#### 3.4 Tag Suggestions

- **Suggest Tags**:
  - Checkbox: "Suggest tags, up to"
  - Number Field (defaults to 5): Maximum number of tags to suggest
  - Description: Tags will be added to each note
- **Tag Prefix**:
  - Text Field (defaults to 'auto-'): "Tag prefix"
  - Description: Add a prefix to help identify tags added by the plugin. Leave blank for no prefix
- **Limit to Existing Tags**:
  - Checkbox: "Limit tag suggestions to only existing tags"

### 4. Import Command Enhancement

- **Dialog with Options**:
  - When the import-google-keep-notes command is invoked by an active subscriber, display a dialog containing the same options as in the settings
  - Pre-fill options with defaults from the settings
  - Allow users to confirm or update entries before importing

### 5. Premium Features Submission

-- **Premium Feature Flags Submission**:
  - For active subscribers, the sync request is sent to a different endpoint: /keep/sync/premium/v2
  - This request is a POST
  - The request body includes a 'feature_flags' json object that contains the premium feature flags derived from the premium feature settings, mapped as described below.
  - includeNotesTerms: 'filter_notes': {'terms':[...]}
  - excludeNotesTerms: 'skip_notes': {'terms': [...]}
  - updateTitle: 'suggest_title': {}
  - suggestTags: 'suggest_tags': {'max_tags', 'restrict_tags', 'prefix'}

## File Structure

The project files are structured to integrate the new features into existing files, minimizing the addition of new files:

```
.
├── LICENSE
├── README.md
├── jest.config.ts
├── main.js
├── manifest.json            # Update if new commands or settings are added
├── package-lock.json
├── package.json
├── scripts
│   └── version-bump.mjs     # moved from repo root
├── src
│   ├── config
│   │   └── index.ts         # Exports KEEPSIDIAN_SERVER_URL
│   ├── main.ts              # Entry; subscription check, auto-sync, modal orchestration
│   ├── app
│   │   ├── commands.ts      # Ribbon and command registration
│   │   ├── sync-ui.ts       # Status bar + progress modal orchestration
│   │   └── logging.ts       # Append to sync log via services/logger
│   ├── ui
│   │   ├── settings
│   │   │   ├── KeepSidianSettingsTab.ts
│   │   │   └── SubscriptionSettingsTab.ts
│   │   └── modals
│   │       ├── NoteImportOptionsModal.ts
│   │       └── SyncProgressModal.ts
│   ├── features
│   │   └── keep
│   │       ├── constants.ts
│   │       ├── domain
│   │       │   ├── note.ts
│   │       │   ├── compare.ts
│   │       │   └── merge.ts
│   │       ├── io
│   │       │   └── attachments.ts
│   │       └── sync.ts      # Orchestrates fetch/pagination/processing
│   ├── integrations
│   │   ├── google
│   │   │   └── keepToken.ts
│   │   └── server
│   │       └── keepApi.ts   # fetchNotes*, PremiumFeatureFlags, endpoints
│   ├── services
│   │   ├── http.ts          # Wraps requestUrl
│   │   ├── logger.ts        # Durable sync log write
│   │   ├── paths.ts         # Path helpers
│   │   └── subscription.ts  # Subscription cache + checks
│   └── types
│       ├── index.ts
│       └── keepsidian-plugin-settings.ts
├── styles.css
├── tsconfig.json
└── versions.json
```

## API Documentation

### /subscriber/info Endpoint

**Endpoint**: /subscriber/info  
**Method**: GET

#### Headers

- **X-User-Email** (required): The email address of the user to check

#### Response Format

**Success** (200 OK):

```json
{
  "subscription_status": "active",
  "plan_details": {
    "plan_id": "premium_monthly",
    "features": ["feature_a", "feature_b"]
  },
  "metering_info": {
    "usage": 150,
    "limit": 1000
  },
  "trial_or_promo": null
}
```

**Error Cases**:

- 400 Bad Request: When X-User-Email header is missing or invalid
  - Missing Header:

    ```json
    {
      "error": "X-User-Email header is required"
    }
    ```

  - Invalid Email Format:

    ```json
    {
      "error": "Invalid email format"
    }
    ```

- 500 Internal Server Error: For unexpected errors

    ```json
    {
      "error": "Internal server error"
    }
    ```

#### Example Usage

```bash
curl -X GET \
  'http://api.example.com/subscriber/info' \
  -H 'X-User-Email: user@example.com'
```

## Implementation Details

### main.ts

**Responsibilities**:

- **Subscription Checking Logic**:
  - On startup or when the cache expires, call the /subscriber/info endpoint
  - Implement error handling for network issues and API errors
- **Cache Management**:
  - Cache subscription information locally (e.g., in local storage) for 24 hours
  - Invalidate the cache upon timeout or when the user's email changes
- **Subscription Status Display**:
  - Update the plugin settings UI with the current subscription status
- **"Check Subscription" Option**:
  - Provide a button in the settings to manually refresh the subscription status

**Notes**:
- Ensure that the email used for the subscription check is securely retrieved and stored
- Handle all possible API responses, including error cases

### config/index.ts

**Responsibilities**:

- Expose runtime configuration for the server
  - `KEEPSIDIAN_SERVER_URL` (no trailing slash)
- Provide a single import point for integrations and services

**Notes**:
- Do not hardcode secrets; keep environment-specific configuration out of the repo

### ui/settings

**Responsibilities**:

- **UI Enhancements**:
  - Display general information about premium features to all users
- **Conditional Rendering**:
  - Inactive Subscribers:
    - Show the "Why Subscribe?" section with relevant links and information
  - Active Subscribers:
    - Display subscription details (e.g., plan name, expiration date)
    - Provide toggles and inputs for premium feature configurations
- **"Check Subscription" Button**:
  - Implement a button that triggers a manual subscription status check

**UI Elements for Premium Features**:

- **Filter Notes**:
  - Checkbox: "Only include notes containing"
  - Input Field: Comma-separated list of keywords
  - Checkbox: "Exclude notes containing"
  - Input Field: Comma-separated list of keywords
- **Title Updates**:
  - Checkbox: "Update title"
  - Description: "The title will be updated based on the note content. The original title will be saved in the note."
- **Tag Suggestions**:
  - Checkbox: "Suggest tags, up to"
  - Number Field (default 5): Maximum number of tags to suggest
  - Description: "Tags will be added to each note."
  - Text Field: "Tag prefix" (default 'auto-')
  - Description: "Add a prefix to help identify tags added by the plugin. Leave blank for no prefix."
  - Checkbox: "Limit tag suggestions to only existing tags"

**Notes**:
- Use appropriate UI components consistent with the Obsidian plugin guidelines
- Validate user inputs where necessary

### features/keep/sync.ts

**Purpose**:
- Orchestrates note import (standard and premium flows) with pagination

**Key Points**:
- Exposes `importGoogleKeepNotes(plugin, callbacks?)` and `importGoogleKeepNotesWithOptions(plugin, options, callbacks?)`
- Converts `NoteImportOptions` to `PremiumFeatureFlags` and passes to server calls
- Uses `setTotalNotes`, `reportSyncProgress`, and `finishSyncUI` from `src/app/sync-ui.ts` for UI updates
- Persists notes, applies duplicate strategy/merges, and downloads attachments

**Endpoints used**: via `integrations/server/keepApi.ts` (`/keep/sync/v2`, `/keep/sync/premium/v2`)

### integrations/server/keepApi.ts

**Responsibilities**:

- Provide server integration functions used by the sync layer
  - `fetchNotes(email, token, offset, limit)` → GET `/keep/sync/v2`
  - `fetchNotesWithPremiumFeatures(email, token, featureFlags, offset, limit)` → POST `/keep/sync/premium/v2`
- Define `PremiumFeatureFlags` used when submitting premium feature options
  - `filter_notes: { terms: string[] }`
  - `skip_notes: { terms: string[] }`
  - `suggest_title: {}`
  - `suggest_tags: { max_tags: number; restrict_tags: boolean; prefix: string }`
- Use `src/services/http.ts` to wrap `requestUrl`

**Headers**:
- `X-User-Email`: user email (required)
- `Authorization`: `Bearer <token>` (required)

**Notes**:
- Keep JSON parsing defensive and typed; support both `.json()` and `.text` responses where appropriate

### types/api.ts (Optional)

**Purpose**:
- Define TypeScript interfaces and types for the API responses and data structures related to the subscription info

**Example Type Definitions**:

```typescript
interface SubscriptionInfo {
  subscription_status: string;
  plan_details: {
    plan_id: string;
    features: string[];
  };
  metering_info: {
    usage: number;
    limit: number;
  };
  trial_or_promo: any;
}

interface PlanDetails {
  plan_id: string;
  features: string[];
}

interface MeteringInfo {
  usage: number;
  limit: number;
}
```

**Notes**:
- Using type definitions helps in catching errors during development and ensures data consistency

## Example Code and Responses

**API Call Example**:

```typescript
async function checkSubscriptionStatus(email: string): Promise<SubscriptionInfo> {
  const response = await fetch('http://api.example.com/subscriber/info', {
    method: 'GET',
    headers: {
      'X-User-Email': email,
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Unknown error occurred');
  }

  const data: SubscriptionInfo = await response.json();
  return data;
}
```

**Example API Response (Success)**:

```json
{
  "subscription_status": "active",
  "plan_details": {
    "plan_id": "premium_monthly",
    "features": ["feature_a", "feature_b"]
  },
  "metering_info": {
    "usage": 150,
    "limit": 1000
  },
  "trial_or_promo": null
}
```

**Example API Response (Error - Missing Email Header)**:

```json
{
  "error": "X-User-Email header is required"
}
```

**UI Component Example (Settings Toggle for Title Update)**:
- Label: "Update title"
- Type: Checkbox
- Description: "The title will be updated based on the note content. The original title will be saved in the note."

## Notes and Considerations

### Error Handling
- Ensure robust error handling for network failures and unexpected API responses
- Provide user feedback in the UI when errors occur

### Security
- Protect user data, especially the email address used for subscription checks
- Do not log sensitive information

### Performance
- Optimize caching to reduce unnecessary API calls
- Ensure that premium features do not degrade the plugin's performance for non-subscribed users

### User Experience
- Maintain consistency with Obsidian's UI/UX guidelines
- Provide clear messages and instructions within the plugin settings

### Testing
- Update or add unit tests and integration tests for new functionalities
- Test scenarios for both active and inactive subscribers

### Documentation
- Update the README.md with information about the premium features
- Provide instructions on how users can subscribe and manage their premium features

By following this PRD, developers will have a clear understanding of the requirements and implementation details for integrating premium features into the KeepSidian Obsidian plugin. The structured approach aims to enhance the plugin while maintaining codebase simplicity and ensuring a seamless user experience.
