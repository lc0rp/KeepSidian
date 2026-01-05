import { z } from "zod";

// Schema for a pre-normalized note as returned by the server
export const PreNormalizedNoteSchema = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
  body: z.string().optional(),
  created: z.string().nullable().optional(),
  updated: z.string().nullable().optional(),
  frontmatter: z.string().optional(),
  frontmatterDict: z.record(z.string(), z.string()).optional(),
  archived: z.boolean().optional(),
  trashed: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  blobs: z.array(z.string()).optional(),
  blob_urls: z.array(z.string().nullable()).optional(),
  blob_names: z.array(z.string()).optional(),
  media: z.array(z.string()).optional(),
  header: z.string().optional(),
});

// Response schema for the Keep import endpoints
export const GoogleKeepImportResponseSchema = z.object({
  notes: z.array(PreNormalizedNoteSchema),
  total_notes: z.number().optional(),
});

// Request schema for premium feature flags (optional; useful for validation/fixtures)
export const PremiumFeatureFlagsSchema = z.object({
  filter_notes: z.object({ terms: z.array(z.string()) }).optional(),
  skip_notes: z.object({ terms: z.array(z.string()) }).optional(),
  // Server expects an empty object if present
  suggest_title: z.object({}).optional(),
  suggest_tags: z
    .object({
      max_tags: z.number(),
      restrict_tags: z.boolean(),
      prefix: z.string(),
    })
    .optional(),
});
