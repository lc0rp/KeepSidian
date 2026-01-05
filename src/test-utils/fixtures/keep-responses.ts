// Reusable fixtures for schema tests

export const validPreNormalizedNote = {
  title: "Sample Note",
  text: "---\nGoogleKeepCreatedDate: 2024-01-01T00:00:00.000Z\n---\nBody",
  created: "2024-01-01T00:00:00.000Z",
  updated: "2024-01-02T00:00:00.000Z",
  archived: false,
  trashed: false,
  labels: ["tag1", "tag2"],
  blobs: [],
  blob_urls: ["https://example.com/file.png"],
  blob_names: ["file.png"],
  media: [],
  header: "",
};

export const validResponsePage = {
  notes: [validPreNormalizedNote],
  total_notes: 1,
};

export const validEmptyResponsePage = {
  notes: [],
};

export const invalidResponseMissingNotes: unknown = {
  total_notes: 3,
};

export const invalidResponseWrongNoteShape: unknown = {
  notes: [{ title: 123 }],
};

export const responseWithNullBlobUrl = {
  notes: [
    {
      ...validPreNormalizedNote,
      blob_urls: [null],
    },
  ],
  total_notes: 1,
};

export const validFlags = {
  filter_notes: { terms: ["work", "idea"] },
  skip_notes: { terms: ["personal"] },
  suggest_title: {},
  suggest_tags: { max_tags: 5, restrict_tags: false, prefix: "auto-" },
};

export const invalidFlagsMissingSuggestTagsFields = {
  suggest_tags: { max_tags: 5 },
} satisfies Record<string, unknown>;

export const invalidFlagsWrongTermsType = {
  filter_notes: { terms: ["ok", 123] },
} satisfies Record<string, unknown>;
