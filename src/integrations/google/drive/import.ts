import { Notice } from 'obsidian';
import { KEEPSIDIAN_SERVER_URL } from '../../../config';
import KeepSidianPlugin from 'main';
import { httpGetArrayBuffer, httpGetJson } from '../../../services/http';

export async function importGoogleDriveFiles(plugin: KeepSidianPlugin) {
  try {
    const files = await httpGetJson<Array<{ id: string; name: string }>>(
      `${KEEPSIDIAN_SERVER_URL}/sync-gdrive`,
      {
        'Content-Type': 'application/json',
        email: plugin.settings.email,
        Authorization: `Bearer ${plugin.settings.gdriveToken}`,
      }
    );
    for (const file of files) {
      await downloadGDriveFile(plugin, file.id, file.name);
    }
    new Notice('Google Drive files imported successfully.');
  } catch (error) {
    console.error(error);
    new Notice('Failed to import Google Drive files.');
  }
}

async function downloadGDriveFile(
  plugin: KeepSidianPlugin,
  fileId: string,
  fileName: string
) {
  try {
    const fileContent = await httpGetArrayBuffer(
      `${KEEPSIDIAN_SERVER_URL}/gdrive-file/${fileId}`,
      { Authorization: `Bearer ${plugin.settings.gdriveToken}` }
    );
    const filePath = `${plugin.settings.gdriveSaveLocation}/${fileName}`;
    await (plugin.app as any).vault.adapter.writeBinary(filePath, fileContent);
  } catch (error) {
    console.error(`Failed to download file ${fileName}:`, error);
  }
}
