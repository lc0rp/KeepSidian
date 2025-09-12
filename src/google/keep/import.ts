import { requestUrl, RequestUrlResponse } from 'obsidian';
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import { normalizeNote, PreNormalizedNote } from './note';
import { normalizePath } from "obsidian";
import KeepSidianPlugin from 'main';
import { handleDuplicateNotes } from './compare';
import { NoteImportOptions } from 'components/NoteImportOptionsModal';
import { processAttachments } from './attachments';

interface GoogleKeepImportResponse {
    notes: Array<PreNormalizedNote>;
    total_notes?: number;
}

interface PremiumFeatureFlags {
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

async function importGoogleKeepNotesBase(
    plugin: KeepSidianPlugin,
    fetchFunction: (plugin: KeepSidianPlugin, offset: number, limit: number) => Promise<GoogleKeepImportResponse>
 ): Promise<number> {
    try {
        let offset = 0;
        const limit = 50;
        let hasError = false;
        let foundError: Error | null = null;
        let totalImported = 0;

        while (true && !hasError) {
            try {
				const response = await fetchFunction(plugin, offset, limit);
				// Inform plugin about total notes if provided by API
				if (
					typeof response.total_notes === "number" &&
					(plugin as any).setTotalNotes
				) {
					try {
						(plugin as any).setTotalNotes(response.total_notes);
					} catch {}
				}
				if (!response.notes || response.notes.length === 0) {
					break;
				}
				await processAndSaveNotes(plugin, response.notes);
				totalImported += response.notes.length;
				offset += limit;
			} catch (error) {
                console.error(`Error fetching notes at offset ${offset}:`, error);
                hasError = true;
                foundError = error as Error;
            }
        }

        if (foundError) {
            throw foundError;
        }

        new Notice('Imported Google Keep notes.');
        return totalImported;
    } catch (error) {
        console.error(error);
        new Notice('Failed to import notes.');
        throw error;
    }
 }

 export async function importGoogleKeepNotes(plugin: KeepSidianPlugin): Promise<number> {
    return await importGoogleKeepNotesBase(plugin, fetchNotes);
 }

 export async function importGoogleKeepNotesWithOptions(plugin: KeepSidianPlugin, options: NoteImportOptions): Promise<number> {
    const featureFlags = convertOptionsToFeatureFlags(options);
    return await importGoogleKeepNotesBase(
        plugin,
        (plugin, offset, limit) => fetchNotesWithPremiumFeatures(plugin, featureFlags, offset, limit)
    );
 }

export async function fetchNotes(plugin: KeepSidianPlugin, offset = 0, limit = 100): Promise<GoogleKeepImportResponse> {
    const response = await requestUrl({
        url: `${KEEPSIDIAN_SERVER_URL}/keep/sync/v2?offset=${offset}&limit=${limit}`,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-User-Email': plugin.settings.email,
            'Authorization': `Bearer ${plugin.settings.token}`
        }
    });

    return parseResponse(response);
}

export async function fetchNotesWithPremiumFeatures(
    plugin: KeepSidianPlugin, 
    featureFlags: PremiumFeatureFlags,
    offset = 0,
    limit = 100
): Promise<GoogleKeepImportResponse> {
    const response = await requestUrl({
        url: `${KEEPSIDIAN_SERVER_URL}/keep/sync/premium/v2?offset=${offset}&limit=${limit}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User-Email': plugin.settings.email,
            'Authorization': `Bearer ${plugin.settings.token}`
        },
        body: JSON.stringify({ feature_flags: featureFlags })
    });

    return parseResponse(response);
}

export function parseResponse(response: RequestUrlResponse): GoogleKeepImportResponse {
    const result = typeof response.json === 'function'
        ? response.json()
        : response.text ? JSON.parse(response.text) : response;
    return result as GoogleKeepImportResponse;
}

export function convertOptionsToFeatureFlags(options: NoteImportOptions): PremiumFeatureFlags {
    const featureFlags: PremiumFeatureFlags = {};
    
    if (options.includeNotesTerms && options.includeNotesTerms.length > 0) {
        featureFlags.filter_notes = {
            terms: options.includeNotesTerms
        };
    }
    
    if (options.excludeNotesTerms && options.excludeNotesTerms.length > 0) {
        featureFlags.skip_notes = {
            terms: options.excludeNotesTerms
        };
    }
    
    if (options.updateTitle) {
        featureFlags.suggest_title = {};
    }
    
    if (options.suggestTags) {
        featureFlags.suggest_tags = {
            max_tags: options.maxTags || 5,
            restrict_tags: options.limitToExistingTags || false,
            prefix: options.tagPrefix || 'auto-'
        };
    }

    return featureFlags;
}

export async function processAndSaveNotes(plugin: KeepSidianPlugin, notes: PreNormalizedNote[]) {
    const saveLocation = plugin.settings.saveLocation;
    
    // Create saveLocation if it doesn't exist
    if (!(await plugin.app.vault.adapter.exists(saveLocation))) {
        await plugin.app.vault.createFolder(saveLocation);
    }

    // Create media subfolder if it doesn't exist
    const mediaFolder = `${saveLocation}/media`;
    if (!(await plugin.app.vault.adapter.exists(mediaFolder))) {
        await plugin.app.vault.createFolder(mediaFolder);
    }

    for (const note of notes) {
        await processAndSaveNote(plugin, note, saveLocation);
        if (typeof (plugin as any).reportSyncProgress === 'function') {
            (plugin as any).reportSyncProgress();
        }
    }
}

export async function processAndSaveNote(plugin: KeepSidianPlugin, note: PreNormalizedNote, saveLocation: string) {
    const normalizedNote = normalizeNote(note);
    const noteTitle = normalizedNote.title;
    let noteFilePath = normalizePath(`${saveLocation}/${noteTitle}.md`);

    const lastSyncedDate = new Date().toISOString();

    // Check if the note file already exists
    const duplicateNotesAction = await handleDuplicateNotes(noteFilePath, normalizedNote, plugin.app);
    if (duplicateNotesAction === 'skip') {
        return;
    } else if (duplicateNotesAction === 'rename') {
        noteFilePath = noteFilePath.replace(/\.md$/, '');
        noteFilePath = `${noteFilePath}-conflict-${lastSyncedDate}.md`;
    }

    // Save the note content
    const mdFrontMatterDict = normalizedNote.frontmatterDict;
    mdFrontMatterDict.KeepSidianLastSyncedDate = lastSyncedDate;
    const mdFrontMatter = Object.entries(mdFrontMatterDict).map(([key, value]) => `${key}: ${value}`).join('\n');
    const mdContentWithSyncDate = `---\n${mdFrontMatter}\n---\n${normalizedNote.body}`;

    await plugin.app.vault.adapter.write(noteFilePath, mdContentWithSyncDate);

    // Process attachments
    // if (note.blob_urls) {
    if (normalizedNote.blob_urls && normalizedNote.blob_urls.length > 0) {
        console.log('Processing attachments');
        await processAttachments(plugin, normalizedNote.blob_urls, saveLocation);
    }
}
