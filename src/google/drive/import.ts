import { requestUrl, Notice } from 'obsidian'; // Import necessary modules
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import KeepSidianPlugin from 'main';

export async function importGoogleDriveFiles(plugin: KeepSidianPlugin) {
    try {
        const response = await requestUrl({
            url: `${KEEPSIDIAN_SERVER_URL}/sync-gdrive`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'email': plugin.settings.email,
                'Authorization': `Bearer ${plugin.settings.gdriveToken}`
            }
        });

        const files = await response.json();

        for (const file of files) {
            await downloadGDriveFile(plugin, file.id, file.name);
        }

        new Notice('Google Drive files imported successfully.');
    } catch (error) {
        console.error(error);
        new Notice('Failed to import Google Drive files.');
    }
}

async function downloadGDriveFile(plugin: KeepSidianPlugin, fileId: string, fileName: string) {
    try {
        const response = await requestUrl({
            url: `${KEEPSIDIAN_SERVER_URL}/gdrive-file/${fileId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${plugin.settings.gdriveToken}`
            }
        });

        const fileContent = await response.arrayBuffer;
        const filePath = `${plugin.settings.gdriveSaveLocation}/${fileName}`;

        await plugin.app.vault.adapter.writeBinary(filePath, fileContent);
    } catch (error) {
        console.error(`Failed to download file ${fileName}:`, error);
    }
}