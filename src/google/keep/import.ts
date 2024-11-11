import { requestUrl, RequestUrlResponse, Notice } from 'obsidian';
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import { normalizeNote, PreNormalizedNote } from './note';
import { normalizePath } from "obsidian";
import KeepSidianPlugin from 'main';
import { handleDuplicateNotes } from './compare';
import { NoteImportOptions } from 'components/NoteImportOptionsModal';
import { processAttachments } from './attachments';

interface GoogleKeepImportResponse {
    notes: Array<PreNormalizedNote>;
    // Add other top-level properties if they exist in the response
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

export async function importGoogleKeepNotes(plugin: KeepSidianPlugin) {
    try {
        const response = await fetchNotes(plugin);
        await processAndSaveNotes(plugin, response.notes);
        new Notice('Notes imported successfully.');
    } catch (error) {
        console.error(error);
        new Notice('Failed to import notes.');
    }
}

export async function importGoogleKeepNotesWithOptions(plugin: KeepSidianPlugin, options: NoteImportOptions) {
    try {
        const featureFlags = convertOptionsToFeatureFlags(options);
        const response = await fetchNotesWithPremiumFeatures(plugin, featureFlags);
        await processAndSaveNotes(plugin, response.notes);
        new Notice('Notes imported successfully.');
    } catch (error) {
        console.error(error);
        new Notice('Failed to import notes.');
    }
}

export async function fetchNotes(plugin: KeepSidianPlugin): Promise<GoogleKeepImportResponse> {
    const response = await requestUrl({
        url: `${KEEPSIDIAN_SERVER_URL}/keep/sync`,
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
    featureFlags: PremiumFeatureFlags
): Promise<GoogleKeepImportResponse> {
    const response = await requestUrl({
        url: `${KEEPSIDIAN_SERVER_URL}/keep/sync/premium`,
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