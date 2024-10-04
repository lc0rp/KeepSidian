import { requestUrl, Notice } from 'obsidian'; // Import necessary modules
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import KeepSidianPlugin from 'main';

export async function connectToGoogleDrive(plugin: KeepSidianPlugin) {
    try {
        console.log('Connecting to Google Drive at ', KEEPSIDIAN_SERVER_URL + '/login');
        const response = await requestUrl({
            url: `${KEEPSIDIAN_SERVER_URL}/login`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'email': plugin.settings.email || '',
            }
        });

        if (response.status === 302) {
            console.log('Redirecting to: ', response.headers.location);
            
        }

        console.log('Response: ', response);
        const { authUrl } = await response.json();

        // Open the auth URL in the default browser
        window.open(authUrl, '_blank');

        // Wait for the user to complete the OAuth flow
        const code = await waitForAuthCode();

        // Exchange the code for tokens
        const tokenResponse = await requestUrl({
            url: `${KEEPSIDIAN_SERVER_URL}/callback?code=${code}`,
            method: 'GET',
        });

        const { access_token, refresh_token } = await tokenResponse.json();

        // Save the tokens
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
    // This is a placeholder. In a real implementation, you'd need to set up a way
    // to receive the auth code, possibly through a local server or by asking the
    // user to paste it.
    return new Promise((resolve) => {
        const code = prompt("Please enter the authorization code:");
        resolve(code || "");
    });
}