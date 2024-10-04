import { requestUrl, RequestUrlResponse, Notice } from 'obsidian';
import { KeepSidianSettingTab } from '../../settings';
import KeepSidianPlugin from 'main';
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import { WebviewTag } from 'electron';

declare global {
    interface Window {
        require: (module: string) => any;
    }
}

async function getOAuthToken(settingsTab: KeepSidianSettingTab, plugin: KeepSidianPlugin, retrieveTokenWebview: WebviewTag): Promise<string> {
    const OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
    const GOOGLE_EMAIL = plugin.settings.email;

    const createButtonClickDetectionScript = (buttonText: string): string => `
        (function() {
            const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes("${buttonText}"));
            if (button) {
                console.log("Found button.");
                button.addEventListener('click', () => console.log("buttonClicked"));
            } else {
                console.log("Button not found.");
            }
        })();
    `;

    const createOverlayScript = (title: string, message: string): string => `
        (function() {
            let overlay = document.getElementById('oauth-guide-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'oauth-guide-overlay';
                Object.assign(overlay.style, {
                    position: 'fixed',
                    top: '10px',
                    right: '10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    padding: '20px',
                    borderRadius: '5px',
                    zIndex: '10000'
                });
                document.body.appendChild(overlay);
                const titleElement = document.createElement('h3');
                titleElement.id = 'oauth-guide-title';
                const messageElement = document.createElement('p');
                messageElement.id = 'oauth-guide-message';
                overlay.appendChild(titleElement);
                overlay.appendChild(messageElement);
            }
            document.getElementById('oauth-guide-title').textContent = '${title}';
            document.getElementById('oauth-guide-message').textContent = '${message}';
        })();
    `;

    const enterEmailScript = (email: string): string => `
        (function() {
            const emailInput = document.querySelector('input[type="email"]');
            if (emailInput) {
                emailInput.value = '${email}';
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                emailInput.focus();
            }
        })();
    `;

    const createDevToolsInstructionsScript = (): string => `
        (function() {
            const overlay = document.getElementById('oauth-guide-overlay');
            if (overlay) {
                document.getElementById('oauth-guide-title').textContent = 'Step 3 of 3: Identify the OAuth Token from Developer Tools';
                const messageElement = document.getElementById('oauth-guide-message');
                messageElement.textContent = 'Almost there! We will launch your Developer Tools momentarily. Follow the instructions below to find the OAuth Token.';

                const ol = document.createElement('ol');
                const instructions = [
                    'In the Developer Tools window, navigate to the Application Tab.',
                    'Expand the Cookies Section in the left sidebar and click google.com.',
                    'Find the cookie named "oauth_token", click it, and copy its value.',
                    'Paste the token into the field below.'
                ];

                instructions.forEach(instruction => {
                    const li = document.createElement('li');
                    li.textContent = instruction;
                    ol.appendChild(li);
                });

                messageElement.appendChild(ol);

                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = 'Paste OAuth Token here';
                input.style.width = '100%';
                input.style.marginTop = '10px';
                input.style.border = '1px solid #ccc';
                input.style.borderRadius = '5px';
                input.style.padding = '5px';
                input.style.height = '30px';
                input.style.backgroundColor = '#f0f0f0';
                input.style.opacity = '0.75';
                input.addEventListener('input', function() {
                    console.log('oauthToken: ' + this.value);
                });

                messageElement.appendChild(input);
            }
        })();
    `;

    return new Promise<string>((resolve, reject) => {
        (async () => {
            try {
                if (!retrieveTokenWebview) {
                    throw new Error('Failed to create webview element.');
                }

                retrieveTokenWebview.loadURL(OAUTH_URL);
                retrieveTokenWebview.show();

                let emailEntered = false;
                let stepTwoDisplayed = false;

                retrieveTokenWebview.addEventListener('console-message', (event) => {
                    if (event.message === 'buttonClicked') {
                        retrieveTokenWebview.executeJavaScript(createDevToolsInstructionsScript());
    
                        setTimeout(() => {
                            retrieveTokenWebview.openDevTools();
                            retrieveTokenWebview.focus();
                        }, 3000);
                    } else if (event.message.startsWith('oauthToken: ')) {
                        const oauthToken = event.message.split('oauthToken: ')[1];
                        exchangeOauthToken(settingsTab, plugin, oauthToken);
                        retrieveTokenWebview.closeDevTools();
                        retrieveTokenWebview.hide();
                        resolve(oauthToken);
                    }
                });

                const startTime = Date.now();
                const timeout = 300000; // 5 minutes timeout

                while ((Date.now() - startTime) < timeout) {
                    const currentUrl = retrieveTokenWebview.getURL();
                    if (!emailEntered && currentUrl.includes("accounts.google.com")) {
                        await retrieveTokenWebview.executeJavaScript(createOverlayScript("Step 1 of 3: Login Below.", "Please start by logging in with your Google Keep account below."));
                        await retrieveTokenWebview.executeJavaScript(enterEmailScript(GOOGLE_EMAIL));
                        emailEntered = true;
                    }

                    if (emailEntered && !stepTwoDisplayed && currentUrl.includes("embeddedsigninconsent")) {
                        await retrieveTokenWebview.executeJavaScript(createOverlayScript("Step 2 of 3: Accept Service Terms.", "Great! Next, please review and agree to the terms below."));
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await retrieveTokenWebview.executeJavaScript(createButtonClickDetectionScript("I agree"));
                        stepTwoDisplayed = true;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                reject(new Error('Timeout: OAuth token retrieval process exceeded 5 minutes.'));
            } catch (error) {
                console.error('Error while opening OAuth URL:', error);
                reject(error);
            }
        })();
    });
}

export async function initRetrieveToken(settingsTab: KeepSidianSettingTab, plugin: KeepSidianPlugin, retrieveTokenWebview: WebviewTag) {
    try {
        await getOAuthToken(settingsTab, plugin, retrieveTokenWebview);
    } catch (error) {
        console.error('Failed to retrieve token:', error);
        new Notice('Failed to retrieve token.');
    }
}

export async function exchangeOauthToken(settingsTab: KeepSidianSettingTab, plugin: KeepSidianPlugin, oauthToken: string) {
    try {
        const response: RequestUrlResponse = await requestUrl({
            url: `${KEEPSIDIAN_SERVER_URL}/register`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: plugin.settings.email,
                oauth_token: oauthToken,
            }),
        });

        const result = await response.json;
        if (result.keep_token) {
            plugin.settings.token = result.keep_token;
            await plugin.saveSettings();
            settingsTab.display();
            new Notice('Token exchanged successfully.');
        } else {
            throw new Error('Failed to exchange token');
        }
    } catch (error) {
        console.error('Error exchanging OAuth token:', error);
        new Notice('Failed to exchange OAuth token.');
    }
}