import { Notice } from 'obsidian';
import { KEEPSIDIAN_SERVER_URL } from '../../../config';
import KeepSidianPlugin from 'main';
import { httpGetJson } from '../../../services/http';

export async function connectToGoogleDrive(plugin: KeepSidianPlugin) {
  try {
    console.log('Connecting to Google Drive at ', KEEPSIDIAN_SERVER_URL + '/login');
    const { authUrl } = await httpGetJson<{ authUrl: string }>(
      `${KEEPSIDIAN_SERVER_URL}/login`,
      {
        'Content-Type': 'application/json',
        email: plugin.settings.email || '',
      }
    );

    window.open(authUrl, '_blank');
    const code = await waitForAuthCode();

    const { access_token, refresh_token } = await httpGetJson<{ access_token: string; refresh_token: string }>(
      `${KEEPSIDIAN_SERVER_URL}/callback?code=${code}`
    );
    plugin.settings.gdriveToken = access_token;
    plugin.settings.gdriveRefreshToken = refresh_token;
    await plugin.saveSettings();
    new Notice('Connected to Google Drive successfully.');
  } catch (error) {
    console.error(error);
    new Notice('Failed to connect to Google Drive.');
  }
}

async function waitForAuthCode(): Promise<string> {
  return new Promise((resolve) => {
    const code = prompt('Please enter the authorization code:');
    resolve(code || '');
  });
}
