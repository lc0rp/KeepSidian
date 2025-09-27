import { RequestUrlResponse } from "obsidian";
import { KEEPSIDIAN_SERVER_URL } from "../../config";
import { httpGetJson, httpPostJson } from "@services/http";
import type { PreNormalizedNote } from "@features/keep/domain/note";
import { GoogleKeepImportResponseSchema, PremiumFeatureFlagsSchema } from "@schemas/keep";

export interface GoogleKeepImportResponse {
	notes: Array<PreNormalizedNote>;
	total_notes?: number;
}

export interface PremiumFeatureFlags {
        filter_notes?: {
                terms: string[];
        };
        skip_notes?: {
                terms: string[];
        };
        suggest_title?: Record<string, never>;
        suggest_tags?: {
                max_tags: number;
                restrict_tags: boolean;
                prefix: string;
        };
}

export interface PushAttachmentPayload {
        name: string;
        mime_type: string;
        data: string;
}

export interface PushNotePayload {
        path: string;
        title?: string;
        content: string;
        attachments?: PushAttachmentPayload[];
}

export interface PushNoteResult {
        path?: string;
        success?: boolean;
        message?: string;
        error?: string;
        keep_url?: string;
}

export interface PushNotesResponse {
        results?: PushNoteResult[];
}

export async function fetchNotes(
    email: string,
    token: string,
    offset = 0,
    limit = 100
): Promise<GoogleKeepImportResponse> {
    const url = `${KEEPSIDIAN_SERVER_URL}/keep/sync/v2?offset=${offset}&limit=${limit}`;
    const headers = {
        "Content-Type": "application/json",
        "X-User-Email": email,
        Authorization: `Bearer ${token}`,
    };
    const raw = await httpGetJson<unknown>(url, headers);
    // Runtime validation with Zod
    return GoogleKeepImportResponseSchema.parse(raw) as GoogleKeepImportResponse;
}

export async function fetchNotesWithPremiumFeatures(
    email: string,
    token: string,
    featureFlags: PremiumFeatureFlags,
    offset = 0,
    limit = 100
): Promise<GoogleKeepImportResponse> {
    const url = `${KEEPSIDIAN_SERVER_URL}/keep/sync/premium/v2?offset=${offset}&limit=${limit}`;
    const headers = {
        "Content-Type": "application/json",
        "X-User-Email": email,
        Authorization: `Bearer ${token}`,
    };
    // Validate outgoing feature flags (throws on invalid shape)
    const validatedFlags = PremiumFeatureFlagsSchema.parse(featureFlags);
    const raw = await httpPostJson<unknown, { feature_flags: PremiumFeatureFlags }>(
        url,
        { feature_flags: validatedFlags },
        headers
    );
    // Runtime validation with Zod
    return GoogleKeepImportResponseSchema.parse(raw) as GoogleKeepImportResponse;
}

export async function pushNotes(
        email: string,
        token: string,
        notes: PushNotePayload[]
): Promise<PushNotesResponse> {
        const url = `${KEEPSIDIAN_SERVER_URL}/keep/push`;
        const headers = {
                "Content-Type": "application/json",
                "X-User-Email": email,
                Authorization: `Bearer ${token}`,
        };
        return await httpPostJson<PushNotesResponse, { notes: PushNotePayload[] }>(
                url,
                { notes },
                headers
        );
}

// Kept for backward compatibility and tests that use it directly
// Deprecated: prefer using schema-validated parsing directly.
// Kept for backward compatibility and tests that use it directly.
export function parseResponse(
    response: RequestUrlResponse
): GoogleKeepImportResponse {
    let raw: unknown;
    const jsonField: unknown = response.json;

    if (typeof jsonField === "function") {
        raw = (jsonField as () => unknown)();
    } else if (jsonField !== undefined) {
        raw = jsonField;
    } else if (typeof response.text === "string" && response.text.length > 0) {
        raw = JSON.parse(response.text);
    } else {
        raw = response as unknown;
    }

    // Try strict validation first; fall back to raw for legacy tests/inputs
    const safe = GoogleKeepImportResponseSchema.safeParse(raw);
    if (safe.success) {
        return safe.data as GoogleKeepImportResponse;
    }
    return raw as GoogleKeepImportResponse;
}
