import * as obsidian from 'obsidian';
import { KeepSidianSettingsTab } from '../../components/KeepSidianSettingsTab';
import KeepSidianPlugin from 'main';
import { KEEPSIDIAN_SERVER_URL } from '../../config';
import { WebviewTag, ConsoleMessageEvent } from 'electron';
import { Notice } from 'obsidian';

declare global {
    interface Window {
        require: (module: string) => any;
    }
}

const sanitizeInput = (input: string): string => {
    return input.replace(/[<>"'&]/g, (char) => {
        const entities: { [key: string]: string } = {
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '&': '&amp;'
        };
        return entities[char];
    });
};

const sanitizeForJS = (input: string): string => {
    return input.replace(/[\\"']/g, '\\$&')
                .replace(/\0/g, '\\0')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r');
};

interface TokenResponse {
    keep_token: string;
    [key: string]: any;
}

function isTokenResponse(obj: any): obj is TokenResponse {
    return typeof obj === 'object' && obj !== null && typeof obj.keep_token === 'string';
}

async function getOAuthToken(settingsTab: KeepSidianSettingsTab, plugin: KeepSidianPlugin, retrieveTokenWebview: WebviewTag): Promise<string> {
    const OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
    const GOOGLE_EMAIL = plugin.settings.email;

    const createButtonClickDetectionScript = (buttonText: string[]): string => `
        (function() {
            const button = Array.from(document.querySelectorAll('button')).find(el => 
                ${buttonText.map(text => `el.textContent.includes("${text}")`).join(' || ')}
            );
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
            document.getElementById('oauth-guide-title').textContent = '${sanitizeInput(title)}';
            document.getElementById('oauth-guide-message').textContent = '${sanitizeInput(message)}';
        })();
    `;

    const enterEmailScript = (email: string): string => `
        (function() {
            const emailInput = document.querySelector('input[type="email"]');
            if (emailInput) {
                emailInput.value = '${sanitizeForJS(sanitizeInput(email))}';
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
        let intervalId: NodeJS.Timeout | undefined;
        let messageHandler: ((event: ConsoleMessageEvent) => void) | undefined;
        let timeoutId: NodeJS.Timeout | undefined;

        const cleanup = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = undefined;
            }
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
            if (messageHandler && retrieveTokenWebview) {
                retrieveTokenWebview.removeEventListener('console-message', messageHandler);
                messageHandler = undefined;
            }
        };

        // Ensure cleanup happens on promise rejection
        const wrappedReject = (error: Error) => {
            cleanup();
            reject(error);
        };

        (async () => {
            try {
                if (!retrieveTokenWebview) {
                    throw new Error('Failed to create webview element.');
                }

                await retrieveTokenWebview.loadURL(OAUTH_URL);
                retrieveTokenWebview.show();

                let emailEntered = false;
                let stepTwoDisplayed = false;

                messageHandler = async (event: ConsoleMessageEvent) => {
                    if (event.message === 'buttonClicked') {
                        retrieveTokenWebview.executeJavaScript(createDevToolsInstructionsScript());
    
                        setTimeout(() => {
                            retrieveTokenWebview.openDevTools();
                            retrieveTokenWebview.focus();
                        }, 3000);
                    } else if (event.message.startsWith('oauthToken: ')) {
                        const oauthToken = event.message.split('oauthToken: ')[1];
                        try {
                            await exchangeOauthToken(settingsTab, plugin, oauthToken);
                            cleanup(); // Ensure cleanup happens before resolving
                            retrieveTokenWebview.closeDevTools();
                            retrieveTokenWebview.hide();
                            resolve(oauthToken);
                        } catch (error) {
                            wrappedReject(error);
                        }
                    }
                };

                retrieveTokenWebview.addEventListener('console-message', messageHandler);

                const startTime = Date.now();
                const timeout = 300000; // 5 minutes timeout

                intervalId = setInterval(async () => {
                    const currentUrl = retrieveTokenWebview.getURL();
                    if (!emailEntered && currentUrl.includes("accounts.google.com")) {
                        await retrieveTokenWebview.executeJavaScript(createOverlayScript("Step 1 of 3: Login Below.", "Please start by logging in with your Google Keep account below."));
                        await retrieveTokenWebview.executeJavaScript(enterEmailScript(GOOGLE_EMAIL));
                        emailEntered = true;
                    }

                    if (emailEntered && !stepTwoDisplayed && currentUrl.includes("embeddedsigninconsent")) {
                        await retrieveTokenWebview.executeJavaScript(createOverlayScript("Step 2 of 3: Accept Service Terms.", "Great! Next, please review and agree to the terms below."));
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await retrieveTokenWebview.executeJavaScript(createButtonClickDetectionScript(["I agree", "Acepto"]));
                        stepTwoDisplayed = true;
                    }

                    if ((Date.now() - startTime) >= timeout) {
                        wrappedReject(new Error('Timeout: OAuth token retrieval process exceeded 5 minutes.'));
                    }
                }, 1000);

                timeoutId = setTimeout(() => {
                    wrappedReject(new Error('Timeout: OAuth token retrieval process exceeded 5 minutes.'));
                }, 300000);
            } catch (error) {
                wrappedReject(error as Error);
            }
        })();
    });
}

export async function initRetrieveToken(settingsTab: KeepSidianSettingsTab, plugin: KeepSidianPlugin, retrieveTokenWebview: WebviewTag) {
    try {
        await getOAuthToken(settingsTab, plugin, retrieveTokenWebview);
    } catch (error) {
        console.error('Failed to retrieve token:', error);
        new Notice(`Failed to retrieve token: ${error.message}`);
        throw error;
    }
}

export async function exchangeOauthToken(settingsTab: KeepSidianSettingsTab, plugin: KeepSidianPlugin, oauthToken: string) {
    try {
        const response: obsidian.RequestUrlResponse = await obsidian.requestUrl({
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

        // Check status before parsing JSON
        if (!response.status || response.status < 200 || response.status >= 300) {
            throw new Error(`Server returned status ${response.status}`);
        }

        try {
            // Obsidian requestUrl exposes `json` as a parsed object (not a function).
            // However, be defensive and also support fetch-like responses or fallback to text parsing.
            let parsed: any;
            const maybeJson: any = (response as any).json;
            if (typeof maybeJson === 'function') {
                parsed = await maybeJson.call(response);
            } else if (maybeJson !== undefined) {
                parsed = maybeJson;
            } else {
                const text = (response as any).text ?? '';
                parsed = text ? JSON.parse(text) : undefined;
            }

            if (!isTokenResponse(parsed)) {
                throw new Error('Invalid response format');
            }

            if (!parsed.keep_token) {
                throw new Error('Server response missing keep_token');
            }

            plugin.settings.token = parsed.keep_token;
            await plugin.saveSettings();
            settingsTab.display();
            new Notice('Token exchanged successfully.');
        } catch (e) {
            throw new Error('Failed to parse server response: ' + e);
        }
    } catch (error) {
        console.error('Error exchanging OAuth token:', error);
        new Notice(`Failed to exchange OAuth token: ${(error as Error).message}`);
        throw error;
    }
}
