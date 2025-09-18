import KeepSidianPlugin from "main";
import { KEEPSIDIAN_SERVER_URL } from "../../config";
import { WebviewTag, ConsoleMessageEvent } from "electron";
import { Notice } from "obsidian";
import { KeepSidianSettingsTab } from "ui/settings/KeepSidianSettingsTab";
import { httpPostJson } from "../../services/http";

declare global {
	interface Window {
		require: (module: string) => any;
	}
}

function logErrorIfNotTest(...args: any[]) {
	try {
		const isTest =
			typeof process !== "undefined" &&
			(process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
		if (!isTest) {
			// eslint-disable-next-line no-console
			console.error(...args);
		}
	} catch {
		// no-op
	}
}

const sanitizeInput = (input: string): string => {
	return input.replace(/[<>"'&]/g, (char) => {
		const entities: { [key: string]: string } = {
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
			"&": "&amp;",
		};
		return entities[char];
	});
};

const sanitizeForJS = (input: string): string => {
	return input
		.replace(/[\\"']/g, "\\$&")
		.replace(/\0/g, "\\0")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
};

interface TokenResponse {
	keep_token: string;
	[key: string]: any;
}

function isTokenResponse(obj: any): obj is TokenResponse {
	return (
		typeof obj === "object" &&
		obj !== null &&
		typeof obj.keep_token === "string"
	);
}

async function getOAuthToken(
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	retrieveTokenWebview: WebviewTag
): Promise<string> {
	const OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
	const GOOGLE_EMAIL = plugin.settings.email;

	const createButtonClickDetectionScript = (buttonText: string[]): string => `
        (function() {
            const button = Array.from(document.querySelectorAll('button')).find(el => 
                ${buttonText
					.map((text) => `el.textContent.includes("${text}")`)
					.join(" || ")}
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
            document.getElementById('oauth-guide-title').textContent = '${sanitizeInput(
				title
			)}';
            document.getElementById('oauth-guide-message').textContent = '${sanitizeInput(
				message
			)}';
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

                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = 'Paste oauth_token here';
                input.id = 'oauth-token-input';
                input.style.width = '100%';
                input.style.marginTop = '10px';
                input.addEventListener('input', (e) => {
                    console.log('oauthToken: ' + (e.target as HTMLInputElement).value);
                });
                overlay.appendChild(ol);
                overlay.appendChild(input);
            }
        })();
    `;

	const getOauthTokenScript = (): string => `
        (function() {
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'oauth_token') {
                    console.log('oauthToken: ' + value);
                    return;
                }
            }
        })();
    `;

	return new Promise((resolve, reject) => {
		let intervalId: ReturnType<typeof setInterval> | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let cleanupCalled = false;

		const cleanup = () => {
			if (!cleanupCalled) {
				if (intervalId !== undefined) {
					clearInterval(intervalId);
					intervalId = undefined;
				}
				if (timeoutId !== undefined) {
					clearTimeout(timeoutId);
					timeoutId = undefined;
				}
				cleanupCalled = true;
			}
		};

		const wrappedReject = (error: Error) => {
			cleanup();
			reject(error);
		};

		(async () => {
			try {
			// Support both Electron WebviewTag and simple mocks used in tests
			if (typeof (retrieveTokenWebview as any).loadURL === "function") {
				await (retrieveTokenWebview as any).loadURL(OAUTH_URL);
			} else {
				(retrieveTokenWebview as any).src = OAUTH_URL;
			}
			if ((retrieveTokenWebview as any).show) {
				(retrieveTokenWebview as any).show();
			}
			const style = (retrieveTokenWebview as any).style;
			if (style) {
				try {
					style.width = "0";
					style.height = "0";
					style.display = "block";
				} catch {
					/* empty */
				}
			}

			let emailEntered = false;
			let stepTwoDisplayed = false;
			let devToolsOpened = false;

			const messageHandler = async (event: ConsoleMessageEvent) => {
				if (event.message === "buttonClicked" && !devToolsOpened) {
					retrieveTokenWebview.openDevTools();
					devToolsOpened = true;
					await retrieveTokenWebview.executeJavaScript(
						createDevToolsInstructionsScript()
					);
					await retrieveTokenWebview.executeJavaScript(
						getOauthTokenScript()
					);
				} else if (event.message === "Token overlay created.") {
					await retrieveTokenWebview.executeJavaScript(
						createDevToolsInstructionsScript()
					);
				} else if (event.message.startsWith("oauthToken: ")) {
					const oauthToken = event.message.split("oauthToken: ")[1];
					try {
						await exchangeOauthToken(
							settingsTab,
							plugin,
							oauthToken
						);
						cleanup();
						if ((retrieveTokenWebview as any).closeDevTools) {
							try {
								(retrieveTokenWebview as any).closeDevTools();
							} catch {
								/* empty */
							}
						}
						if ((retrieveTokenWebview as any).hide) {
							try {
								(retrieveTokenWebview as any).hide();
							} catch {
								/* empty */
							}
						} else {
							const style = (retrieveTokenWebview as any).style;
							if (style) {
								try {
									style.display = "none";
								} catch {
									/* empty */
								}
							}
						}
						resolve(oauthToken);
					} catch (error) {
						wrappedReject(error as Error);
					}
				}
			};

			retrieveTokenWebview.addEventListener(
				"console-message",
				messageHandler
			);

			const startTime = Date.now();
			const timeout = 300000;

			intervalId = setInterval(async () => {
				const currentUrl =
					typeof (retrieveTokenWebview as any).getURL === "function"
						? (retrieveTokenWebview as any).getURL()
						: "";
				if (!currentUrl || typeof currentUrl !== "string") {
					return;
				}
				if (
					!emailEntered &&
					currentUrl.includes("accounts.google.com")
				) {
					await retrieveTokenWebview.executeJavaScript(
						createOverlayScript(
							"Step 1 of 3: Login Below.",
							"Please start by logging in with your Google Keep account below."
						)
					);
					await retrieveTokenWebview.executeJavaScript(
						enterEmailScript(GOOGLE_EMAIL)
					);
					emailEntered = true;
				}

				if (
					emailEntered &&
					!stepTwoDisplayed &&
					currentUrl.includes("embeddedsigninconsent")
				) {
					await retrieveTokenWebview.executeJavaScript(
						createOverlayScript(
							"Step 2 of 3: Accept Service Terms.",
							"Great! Next, please review and agree to the terms below."
						)
					);
					await new Promise((resolve) => setTimeout(resolve, 500));
					await retrieveTokenWebview.executeJavaScript(
						createButtonClickDetectionScript(["I agree", "Acepto"])
					);
					stepTwoDisplayed = true;
				}

				if (Date.now() - startTime >= timeout) {
					wrappedReject(
						new Error(
							"Timeout: OAuth token retrieval process exceeded 5 minutes."
						)
					);
				}
			}, 1000);

			timeoutId = setTimeout(() => {
				wrappedReject(
					new Error(
						"Timeout: OAuth token retrieval process exceeded 5 minutes."
					)
				);
			}, 300000);
			} catch (error) {
				wrappedReject(error as Error);
			}
		})().catch((error) => {
			wrappedReject(error as Error);
		});
	});
}

export async function initRetrieveToken(
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	retrieveTokenWebview: WebviewTag
) {
	try {
		await getOAuthToken(settingsTab, plugin, retrieveTokenWebview);
	} catch (error) {
		logErrorIfNotTest("Failed to retrieve token:", error);
		new Notice(`Failed to retrieve token: ${(error as Error).message}`);
		throw error;
	}
}

export async function exchangeOauthToken(
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	oauthToken: string
) {
	try {
		try {
			const parsed = await httpPostJson<
				TokenResponse,
				{ email: string; oauth_token: string }
			>(
				`${KEEPSIDIAN_SERVER_URL}/register`,
				{
					email: plugin.settings.email,
					oauth_token: oauthToken,
				},
				{ "Content-Type": "application/json" }
			);

			if (!isTokenResponse(parsed)) {
				throw new Error("Invalid response format");
			}

			if (!parsed.keep_token) {
				throw new Error("Server response missing keep_token");
			}

			plugin.settings.token = parsed.keep_token;
			await plugin.saveSettings();
			settingsTab.display();
			new Notice("Token exchanged successfully.");
		} catch (e) {
			// Preserve legacy error message shape expected by tests
			if (
				e instanceof Error &&
				e.message.startsWith("Server returned status")
			) {
				throw e;
			}
			throw new Error("Failed to parse server response: " + e);
		}
	} catch (error) {
		logErrorIfNotTest("Error exchanging OAuth token:", error);
		new Notice(
			`Failed to exchange OAuth token: ${(error as Error).message}`
		);
		throw error;
	}
}
