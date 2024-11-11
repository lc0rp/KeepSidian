# Premium Features Overview
You're adding "Premium Features" to the KeepSidian Obisidian plugin. 

With this feature, the plugin checks if the user id subscribed, and then displays a few more options, including two-wasy sync, title suggestions, tag creation and more.

# Core Module Functionality
1. Check subscription status of the current user.
    1. On startup or when cache expires, call /subscriber/info endpoint to check user status. See 'Docs' section for a description of this endpoint and how it works.
    2. Cache subscription information locally for 24 hours.
    3. Provide a "Check Subscription" option in plugin settings, which refreshes and caches subscription info.
    4. Invalidate the cache upon cache timeout/expiry, or when the user's email address changes.
    5. Display the subscription status in the plugin settings
2. In plugin settings, display information about the premium features and how to subscribe.
    1. Everyone sees general premium features info
    2. Only inactive subscribers see the 'how to subscribe' section
    3. Active subscribers see information about their subscription in the plugin settings.
3. If subscription is active, expose extra features in the plugin settings, with the ability for the user to toggle them on/off
    1. Filter notes 
        1. Checkbox: Only include notes containing [Input field: Comma separated list]
        2. Checkbox: Exclude notes containing [Input field: Comma separated list]
    2. Title
        1. Checkbox: Update title, Description: The title will be updated based on the note content. The original title will be saved in the note.
    3. Tags
        1. Checkbox: Suggest tags, up to [Number field defaults to 5], Description: Tags will be added to each note.
        2. Text field: Tag prefix (defaults to 'auto-'). Description: Add a prefix to help identify tags added by the plugin. Leave blank for no -refix.
        3. Checkbox: Limit tag suggestions to only existing tags
4. For users with an active subscription, the import-google-keep-notes command should popupa a dialog with the same options as described above, with any defaults set from the values in settings, and allow the user to confirm or update the entries before importing.

# Docs

## Docs for /subscriber/info endpoint

**Endpoint:** `/subscriber/info`  
**Method:** GET 

#### Headers
- `X-User-Email` (required): The email address of the user to check

#### Response Format

**Success (200 OK):**
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

**Error Cases:**
- 400 Bad Request: When X-User-Email header is missing
```json
{
    "error": "X-User-Email header is required"
}
```
- 400 Bad Request: When there's a validation error
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

# Current file structure 
.
├── LICENSE
├── README.md
├── esbuild.config.mjs
├── eslint.config.mjs
├── jest.config.ts
├── main.js
├── manifest.json
├── package-lock.json
├── package.json
├── src
│   ├── config.ts
│   ├── google
│   ├── main.ts
│   ├── settings.ts
│   ├── tests
│   └── types
├── styles.css
├── tsconfig.json
├── version-bump.mjs
└── versions.json

# Proposed file structure
.
├── LICENSE
├── README.md
├── esbuild.config.mjs
├── eslint.config.mjs
├── jest.config.ts
├── main.js
├── manifest.json           # Update if new commands or settings are added
├── package-lock.json
├── package.json
├── src
│   ├── config.ts           # Update with new premium feature settings
│   ├── google
│   │   ├── import.ts       # Modify to include premium feature options during import
│   │   └── ...             # Other existing files
│   ├── main.ts             # Implement subscription checking and cache logic
│   ├── settings.ts         # Update UI to display premium features and toggles
│   ├── tests
│   │   └── ...             # Update or add tests for new features
│   └── types
│       ├── api.ts          # (Optional) Define types for API responses
│       └── ...             # Other existing type definitions
├── styles.css
├── tsconfig.json
├── version-bump.mjs
└── versions.json

# File structure rationale