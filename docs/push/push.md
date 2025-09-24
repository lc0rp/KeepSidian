
# Push notes to Google Keep

- POST `/keep/push`: accepts `{ "notes": [...] }` payload of Obsidian markdown and returns per-note results

## Push notes

`POST /keep/push` expects a JSON body of the form:

```json
{
  "notes": [
    {
      "path": "Daily/Some note.md",
      "title": "Optional explicit title",
      "content": "---\n...frontmatter...\n---\nNote body",
      "attachments": [
        {
          "name": "photo.png",
          "mime_type": "image/png",
          "data": "<base64-encoded bytes>"
        }
      ]
    }
  ]
}
```

Notes are parsed using their Obsidian frontmatter (including `GoogleKeepUrl`,
`GoogleKeepCreatedDate`, `GoogleKeepUpdatedDate`, and
`KeepSidianLastSyncedDate`). Relative links like `[[Other note]]` or
`[See this](Other%20note.md)` are rewritten to Google Keep URLs when the target
note includes Keep metadata in the push payload. Attachments are embedded into
the note body as base64 payload blocks so that their contents survive future
exports even when Google Keep cannot accept direct uploads.

Whenever an existing Google Keep note is modified, the service creates a copy
labelled with `_backup-YYYY-mm-dd-*` and archives it before applying the
update. If the current Keep version is newer than the data sent from Obsidian,
the API creates a conflict copy instead of overwriting the original.
