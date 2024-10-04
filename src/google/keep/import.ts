import { requestUrl, RequestUrlResponse, Notice } from 'obsidian'; // Import necessary modules
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import { normalizeNote, PreNormalizedNote } from './note';
import { normalizePath } from "obsidian";
import KeepSidianPlugin from 'main';
import { handleDuplicateNotes } from './compare';

// Define the SyncResponse interface
interface GoogleKeepImportResponse {
	notes: Array<PreNormalizedNote>;
	// Add other top-level properties if they exist in the response
}

export async function importGoogleKeepNotes(plugin: KeepSidianPlugin) { 
    try {
        const response: RequestUrlResponse = await requestUrl({
            url: `${KEEPSIDIAN_SERVER_URL}/sync`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'email': plugin.settings.email,
                'Authorization': `Bearer ${plugin.settings.token}`
            }
        });

        // Check if response.json is available
        const result = typeof response.json === 'function'
            ? await response.json()
            : response.text ? JSON.parse(response.text) : response;

        // Type assertion
        const typedResult = result as GoogleKeepImportResponse;
        const notes = typedResult.notes;
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
            const normalizedNote = normalizeNote(note);
            const noteTitle = normalizedNote.title;
            let noteFilePath = normalizePath(`${saveLocation}/${noteTitle}.md`);

            const lastSyncedDate = new Date().toISOString();

            // Check if the note file already exists
            const duplicateNotesAction = await handleDuplicateNotes(noteFilePath, normalizedNote, plugin.app);
            if (duplicateNotesAction === 'skip') {
                continue;
            } else if (duplicateNotesAction === 'rename') {
                noteFilePath = noteFilePath.replace(/\.md$/, '');
                noteFilePath = `${noteFilePath}-conflict-${lastSyncedDate}.md`;
            }

            // Save the note content to a markdown file
            // Add syncDate to the frontmatter, which may already exist or not
            const mdFrontMatterDict = normalizedNote.frontmatterDict;
            mdFrontMatterDict.KeepSidianLastSyncedDate = lastSyncedDate;
            const mdFrontMatter = Object.entries(mdFrontMatterDict).map(([key, value]) => `${key}: ${value}`).join('\n');
            const mdContentWithSyncDate = `---\n${mdFrontMatter}\n---\n${normalizedNote.body}`;

            await plugin.app.vault.adapter.write(noteFilePath, mdContentWithSyncDate);

            // Download and save each blob_url
            if (note.blob_urls) {
                for (const blob_url of note.blob_urls) {
                    try {
                        const blobResponse: RequestUrlResponse = await requestUrl({
                            url: blob_url,
                            method: 'GET',
                        });
                        const blobData = await blobResponse.arrayBuffer;
                        const blobFileName = blob_url.split('/').pop();
                        const blobFilePath = `${saveLocation}/media/${blobFileName}`;
                        await plugin.app.vault.adapter.writeBinary(blobFilePath, blobData);
                    } catch (error) {
                        console.error(error);
                        throw new Error(`Failed to download blob from ${blob_url}.`);
                    }
                }
            }
        }
        new Notice('Notes imported successfully.');
    } catch (error) {
        console.error(error);
        new Notice('Failed to import notes.');
    }
}