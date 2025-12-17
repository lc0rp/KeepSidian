import KeepSidianPlugin from "main";
import { KEEPSIDIAN_SERVER_URL } from "../../config";
import type { WebviewTag, ConsoleMessageEvent } from "electron";
import type {
	CookiesGetFilter,
	Cookie,
	WebRequest,
	OnHeadersReceivedListenerDetails,
	HeadersReceivedResponse,
} from "electron";
import { Platform } from "obsidian";

type WebRequestWithRemoval = WebRequest & {
	removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
	off?: (event: string, listener: (...args: unknown[]) => void) => void;
};
import { Notice } from "obsidian";
import { KeepSidianSettingsTab } from "ui/settings/KeepSidianSettingsTab";
import { httpPostJson } from "../../services/http";
import { HIDDEN_CLASS } from "@app/ui-constants";
import { endRetrievalWizardSession, logRetrievalWizardEvent } from "./retrievalSessionLogger";

declare global {
	interface Window {
		require: <T = unknown>(module: string) => T;
	}
}

function logErrorIfNotTest(...args: unknown[]) {
	try {
		const isTest =
			typeof process !== "undefined" &&
			(process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
		if (!isTest) {
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

const redactToken = (token: string): string => {
	if (!token) {
		return "";
	}
	const trimmed = token.trim();
	if (trimmed.length <= 8) {
		return `${trimmed.length === 0 ? "empty" : "short"}-token`;
	}
	const start = trimmed.slice(0, 4);
	const end = trimmed.slice(-4);
	return `${start}…${end}`;
};

const logSessionEvent = (
	level: "info" | "warn" | "error" | "debug",
	message: string,
	metadata: Record<string, unknown> = {}
) => {
	void logRetrievalWizardEvent(level, message, metadata);
};

const ensureDesktopEnvironment = () => {
	if (typeof Platform !== "undefined" && Platform.isMobileApp) {
		throw new Error("Token retrieval wizard is only available on desktop.");
	}
};

const summarizeUrl = (value: string) => {
	try {
		const parsed = new URL(value);
		return {
			origin: parsed.origin,
			pathname: parsed.pathname,
			searchKeys: Array.from(parsed.searchParams.keys()),
		};
	} catch {
		return { raw: value.slice(0, 120) };
	}
};

interface TokenResponse {
	keep_token: string;
	[key: string]: unknown;
}

type TestableWebview = WebviewTag & {
	loadURL?: (url: string) => Promise<void> | void;
	src?: string;
	show?: () => void;
	hide?: () => void;
	closeDevTools?: () => void;
	getURL?: () => string;
	isDestroyed?: () => boolean;
};

class WebviewStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebviewStateError";
	}
}

const webviewUrlErrorLogMap = new WeakMap<WebviewTag, number>();

function isTokenResponse(obj: unknown): obj is TokenResponse {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"keep_token" in obj &&
		typeof (obj as Record<string, unknown>).keep_token === "string"
	);
}

function waitForWebviewReady(wv: WebviewTag, timeoutMs = 30000) {
	return new Promise<void>((resolve, reject) => {
		let done = false;
		logSessionEvent("debug", "Waiting for webview dom-ready", {
			timeoutMs,
		});
		const cleanup = () => {
			wv.removeEventListener("dom-ready", onReady);
			wv.removeEventListener("destroyed", onDestroyed);
		};
		const onReady = () => {
			if (!done) {
				done = true;
				logSessionEvent("info", "Webview dom-ready received");
				cleanup();
				resolve();
			}
		};
		const onDestroyed = () => {
			if (!done) {
				done = true;
				logSessionEvent("warn", "Webview destroyed before dom-ready");
				cleanup();
				reject(new Error("webview destroyed before ready"));
			}
		};
		const t = setTimeout(() => {
			if (!done) {
				done = true;
				logSessionEvent("error", "Webview dom-ready timeout", { timeoutMs });
				cleanup();
				reject(new Error("webview dom-ready timeout"));
			}
		}, timeoutMs);

		wv.addEventListener(
			"dom-ready",
			() => {
				clearTimeout(t);
				onReady();
			},
			true
		);
		wv.addEventListener("destroyed", onDestroyed, true);
	});
}

async function safeGetUrl(wv: WebviewTag) {
	// Only call after waitForWebviewReady has resolved.
	const element = wv as unknown as Element | undefined;
	const testable = wv as TestableWebview;
	if (element && element.isConnected === false) {
		throw new WebviewStateError("OAuth window detached before login finished.");
	}
	if (typeof testable.isDestroyed === "function" && testable.isDestroyed()) {
		throw new WebviewStateError("OAuth window closed before login finished.");
	}
	try {
		if (typeof wv.getURL === "function") {
			const url = wv.getURL();
			return typeof url === "string" ? url : "";
		}
	} catch (error) {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		const lastLoggedAt = webviewUrlErrorLogMap.get(wv) ?? 0;
		const now = Date.now();
		if (now - lastLoggedAt > 2_000) {
			logErrorIfNotTest("Failed to read webview URL", normalizedError);
			logSessionEvent("warn", "Failed to read webview URL", {
				errorMessage: normalizedError.message,
			});
			webviewUrlErrorLogMap.set(wv, now);
		} else {
			logSessionEvent("debug", "Suppressed repeated webview URL read error", {
				errorMessage: normalizedError.message,
			});
		}
		throw normalizedError;
	}
	return "";
}

function resolveElectron(): typeof import("electron") | undefined {
	try {
		const globalScope = (Function("return this")() as {
			require?: <T>(module: string) => T;
			window?: { require?: <T>(module: string) => T };
		}) ?? {};
		if (typeof globalScope.require === "function") {
			return globalScope.require<typeof import("electron")>("electron");
		}
		const maybeWindowRequire = globalScope.window?.require;
		if (typeof maybeWindowRequire === "function") {
			return maybeWindowRequire<typeof import("electron")>("electron");
		}
	} catch (error) {
		logErrorIfNotTest("Failed to resolve electron module", error);
		logSessionEvent("error", "Failed to resolve electron module", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
	return undefined;
}

async function attachPartitionCookieWatcher(
	partition: string | undefined,
	onToken: (token: string, source: string) => void
): Promise<RemoveListener | undefined> {
	if (!partition) {
		logSessionEvent(
			"info",
			"Skipping oauth_token cookie watcher: no partition attribute on webview"
		);
		return undefined;
	}
	try {
		const electron = resolveElectron();
		if (!electron) {
			logSessionEvent("warn", "Electron module unavailable; cannot watch cookies", { partition });
			return undefined;
		}
		const partitionSession = electron.session?.fromPartition?.(partition);
		const partitionCookies = (partitionSession as
			| { cookies?: { on?: unknown; removeListener?: unknown } }
			| undefined
		)?.cookies;
		const partitionHasCookieAPI =
			typeof partitionCookies?.on === "function" &&
			typeof partitionCookies?.removeListener === "function";
		if (!partitionSession) {
			logSessionEvent("warn", "Partition session unavailable for cookies; considering default session", {
				partition,
			});
		} else if (!partitionHasCookieAPI) {
			logSessionEvent("warn", "Partition session missing cookie listener APIs; considering default session", {
				partition,
				hasCookies: Boolean(partitionCookies),
				hasOn: typeof partitionCookies?.on,
				hasRemoveListener: typeof partitionCookies?.removeListener,
			});
		}
		const targetSession = partitionHasCookieAPI
			? partitionSession
			: electron.session?.defaultSession;
		const cookiesModule = targetSession?.cookies;
		if (!targetSession || !cookiesModule?.on || !cookiesModule.removeListener) {
			logSessionEvent("warn", "Resolved session missing cookie APIs; skipping watcher", {
				partition,
				usedDefault: targetSession === electron.session?.defaultSession,
				hasSession: Boolean(targetSession),
				hasOn: Boolean(cookiesModule?.on),
				hasRemoveListener: Boolean(cookiesModule?.removeListener),
			});
			return undefined;
		}
		logSessionEvent("debug", "Using session for cookie watcher", {
			partition,
			usedDefault: targetSession === electron.session?.defaultSession,
		});
		const listener = (_event: unknown, cookie: Cookie, cause: string, removed: boolean) => {
			try {
				if (removed) {
					return;
				}
				if (cookie?.name === "oauth_token" && cookie.value) {
					logSessionEvent("info", "Detected oauth_token cookie via partition watcher", {
						cause,
						tokenSample: redactToken(cookie.value),
					});
					onToken(cookie.value, "cookies-changed");
				}
			} catch (error) {
				logErrorIfNotTest("Cookie watcher failed", error);
				logSessionEvent("error", "Cookie watcher failed", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		};
		cookiesModule.on("changed", listener as unknown as (...args: unknown[]) => void);
		logSessionEvent("info", "Attached oauth_token cookie watcher", {
			partition,
			usedDefault: targetSession === electron.session?.defaultSession,
		});
		return () => {
			try {
				cookiesModule.removeListener(
					"changed",
					listener as unknown as (...args: unknown[]) => void
				);
				logSessionEvent("debug", "Removed oauth_token cookie watcher", { partition });
			} catch (error) {
				logSessionEvent("warn", "Failed removing oauth_token cookie watcher", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		};
	} catch (error) {
		logErrorIfNotTest("Unable to attach oauth_token cookie watcher", error);
		logSessionEvent("error", "Unable to attach oauth_token cookie watcher", {
			errorMessage: error instanceof Error ? error.message : String(error),
			partition,
		});
		return undefined;
	}
}

function extractOauthTokenFromHeaderValue(value: string): string | undefined {
	const match = value.match(/oauth_token=([^;]+)/i);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

async function attachWebRequestWatcher(
	partition: string | undefined,
	onToken: (token: string, source: string) => void
): Promise<RemoveListener | undefined> {
	if (!partition) {
		logSessionEvent(
			"info",
			"Skipping oauth_token webRequest watcher: no partition attribute on webview"
		);
		return undefined;
	}
	try {
		const electron = resolveElectron();
		if (!electron) {
			logSessionEvent(
				"warn",
				"Electron module unavailable; cannot attach webRequest watcher",
				{
					partition,
				}
			);
			return undefined;
		}
		const partitionSession = electron.session?.fromPartition?.(partition);
		const partitionWebRequest = (partitionSession as
			| { webRequest?: { onHeadersReceived?: unknown; removeListener?: unknown; off?: unknown } }
			| undefined
		)?.webRequest;
		const partitionHasWebRequestAPI =
			typeof partitionWebRequest?.onHeadersReceived === "function";
		if (!partitionSession) {
			logSessionEvent("warn", "Partition session unavailable for webRequest; considering default session", {
				partition,
			});
		} else if (!partitionHasWebRequestAPI) {
			logSessionEvent("warn", "Partition session missing webRequest.onHeadersReceived; considering default session", {
				partition,
				hasWebRequest: Boolean(partitionWebRequest),
				hasOnHeadersReceived: typeof partitionWebRequest?.onHeadersReceived,
			});
		}
		const targetSession = partitionHasWebRequestAPI
			? partitionSession
			: electron.session?.defaultSession;
		const webRequest = targetSession?.webRequest as WebRequestWithRemoval | undefined;
		if (!targetSession || !webRequest?.onHeadersReceived) {
			logSessionEvent("warn", "Resolved session missing webRequest APIs; skipping watcher", {
				partition,
				usedDefault: targetSession === electron.session?.defaultSession,
				hasSession: Boolean(targetSession),
				hasOnHeadersReceived: Boolean(webRequest?.onHeadersReceived),
			});
			return undefined;
		}
		logSessionEvent("debug", "Using session for webRequest watcher", {
			partition,
			usedDefault: targetSession === electron.session?.defaultSession,
		});
		const filter = {
			urls: [
				"https://accounts.google.com/*",
				"https://keep.google.com/*",
				"https://oauthaccountmanager.googleapis.com/*",
			],
		};
		const listener = (
			details: OnHeadersReceivedListenerDetails,
			callback: (response: HeadersReceivedResponse) => void
		) => {
			try {
				const headers = details.responseHeaders ?? {};
				for (const [key, value] of Object.entries(headers)) {
					if (key.toLowerCase() !== "set-cookie" || !value) {
						continue;
					}
					const values = Array.isArray(value) ? value : [value];
					for (const entry of values) {
						const token = extractOauthTokenFromHeaderValue(entry);
						if (token) {
							logSessionEvent("info", "Detected oauth_token via webRequest headers", {
								sourceUrl: details.url,
								tokenSample: redactToken(token),
							});
							onToken(token, "webRequest");
							return callback({
								cancel: false,
								responseHeaders: details.responseHeaders,
							});
						}
					}
				}
			} catch (error) {
				logErrorIfNotTest("webRequest watcher failed", error);
				logSessionEvent("error", "webRequest watcher failed", {
					errorMessage: error instanceof Error ? error.message : String(error),
					sourceUrl: details.url,
				});
			} finally {
				callback({ cancel: false, responseHeaders: details.responseHeaders });
			}
		};
		webRequest.onHeadersReceived(filter, listener);
		logSessionEvent("info", "Attached oauth_token webRequest watcher", {
			partition,
			usedDefault: targetSession === electron.session?.defaultSession,
		});
		return () => {
			try {
				if (typeof webRequest?.removeListener === "function") {
					webRequest.removeListener(
						"headers-received",
						listener as unknown as (...args: unknown[]) => void
					);
				} else if (typeof webRequest?.off === "function") {
					webRequest.off(
						"headers-received",
						listener as unknown as (...args: unknown[]) => void
					);
				}
				logSessionEvent("debug", "Removed oauth_token webRequest watcher", { partition });
			} catch (error) {
				logSessionEvent("warn", "Failed removing oauth_token webRequest watcher", {
					errorMessage: error instanceof Error ? error.message : String(error),
					partition,
				});
			}
		};
	} catch (error) {
		logErrorIfNotTest("Unable to attach oauth_token webRequest watcher", error);
		logSessionEvent("error", "Unable to attach oauth_token webRequest watcher", {
			errorMessage: error instanceof Error ? error.message : String(error),
			partition,
		});
		return undefined;
	}
}

async function readOauthTokenFromPartition(partition: string): Promise<string | undefined> {
	try {
		logSessionEvent("debug", "Reading oauth_token from partition", { partition });
		const globalWithRequire =
			(Function("return this")() as {
				require?: <T = unknown>(module: string) => T;
			}) ?? {};
		if (typeof globalWithRequire.require !== "function") {
			return undefined;
		}
		const electron = globalWithRequire.require<typeof import("electron")>("electron");
		const partitionSession = electron.session?.fromPartition?.(partition);
		if (!partitionSession?.cookies?.get) {
			return undefined;
		}
		const filters: CookiesGetFilter[] = [
			{ name: "oauth_token" },
			{ domain: ".google.com", name: "oauth_token" },
			{ domain: "google.com", name: "oauth_token" },
			{ domain: "accounts.google.com", name: "oauth_token" },
			{ url: "https://accounts.google.com", name: "oauth_token" },
			{ url: "https://keep.google.com", name: "oauth_token" },
		];
		for (const filter of filters) {
			try {
				logSessionEvent("debug", "Checking partition cookies", {
					filter,
				});
				const cookies = await partitionSession.cookies.get(filter);
				const match = cookies?.find(
					(cookie) => cookie.name === "oauth_token" && !!cookie.value
				);
				if (match?.value) {
					logSessionEvent("info", "Found oauth_token cookie in partition", {
						filter,
						tokenSample: redactToken(match.value),
					});
					return match.value;
				}
			} catch (error) {
				logErrorIfNotTest("Failed reading oauth_token cookie with filter", filter, error);
				logSessionEvent("error", "Failed reading oauth_token cookie with filter", {
					filter,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		}
	} catch (error) {
		logErrorIfNotTest("Failed to access electron session for oauth_token", error);
		logSessionEvent("error", "Failed to access electron session for oauth_token", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
	logSessionEvent("debug", "oauth_token cookie not found in partition", { partition });
	return undefined;
}

const delay = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

type RemoveListener = () => void;

function wireOAuthHandlers(
	wv: WebviewTag,
	redirectUri: string,
	onCode: (code: string) => void,
	onError: (err: Error) => void,
	onUrlChange?: (url: string) => void
): RemoveListener {
	const removeListeners: RemoveListener[] = [];
	logSessionEvent("debug", "Binding OAuth webview handlers", { redirectUri });
	const tryParse = (url: string) => {
		if (!url || !url.startsWith(redirectUri)) {
			return false;
		}
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(url);
		} catch {
			logSessionEvent("warn", "Failed to parse OAuth redirect URL", {
				urlPreview: url.slice(0, 120),
			});
			return false;
		}
		const metadata = {
			origin: parsedUrl.origin,
			pathname: parsedUrl.pathname,
			hasCode: parsedUrl.searchParams.has("code"),
			hasError: parsedUrl.searchParams.has("error"),
		};
		logSessionEvent("debug", "Processing OAuth redirect", metadata);
		const err = parsedUrl.searchParams.get("error");
		if (err) {
			logSessionEvent("error", "OAuth provider returned error", {
				error: err,
				...metadata,
			});
			onError(new Error(`OAuth error: ${err}`));
			return true;
		}
		const code = parsedUrl.searchParams.get("code");
		if (code) {
			logSessionEvent("info", "OAuth code received", metadata);
			onCode(code);
			return true;
		}
		const path = parsedUrl.pathname.toLowerCase();
		const consentAccepted = parsedUrl.searchParams.get("consent") === "accepted";
		const looksLikeConsent = path.includes("consent");
		const looksLikeCompletion =
			path.includes("success") ||
			path.includes("complete") ||
			path.includes("done") ||
			path.includes("finish");
		if (looksLikeConsent && (looksLikeCompletion || consentAccepted)) {
			logSessionEvent("info", "OAuth consent redirect detected", metadata);
			onCode(parsedUrl.toString());
			return true;
		}
		return false;
	};

	const bind = (target: WebviewTag, event: string, handler: (...args: unknown[]) => void) => {
		const wrapped = handler as unknown as EventListener;
		target.addEventListener(event, wrapped);
		removeListeners.push(() => {
			try {
				target.removeEventListener(event, wrapped);
			} catch {
				/* empty */
			}
		});
	};

	const redirectHandler = (e: { url?: string }) => {
		if (typeof e?.url === "string") {
			logSessionEvent("debug", "Navigation event captured", summarizeUrl(e.url));
			onUrlChange?.(e.url);
			tryParse(e.url);
		}
	};

	// Fires on most OAuth flows
	bind(wv, "did-redirect-navigation", redirectHandler);
	bind(wv, "did-navigate", redirectHandler);
	bind(wv, "did-navigate-in-page", redirectHandler);

	// Some providers open a popup window
	const createWindowHandler = (e: { window?: WebviewTag | null }) => {
		const child = e.window;
		if (!child) {
			logSessionEvent("debug", "OAuth popup attempted without window");
			return;
		}
		logSessionEvent("info", "OAuth popup window created");
		const childHandler = (event: { url?: string }) => {
			if (typeof event?.url === "string") {
				logSessionEvent("debug", "Popup navigation event", summarizeUrl(event.url));
				onUrlChange?.(event.url);
				tryParse(event.url);
			}
		};
		const wrappedChildHandler = childHandler as unknown as EventListener;
		child.addEventListener("did-redirect-navigation", wrappedChildHandler);
		child.addEventListener("did-navigate", wrappedChildHandler);
		removeListeners.push(() => {
			try {
				child.removeEventListener("did-redirect-navigation", wrappedChildHandler);
				child.removeEventListener("did-navigate", wrappedChildHandler);
			} catch {
				/* empty */
			}
		});
	};

	bind(wv, "did-create-window", createWindowHandler);

	return () => {
		while (removeListeners.length > 0) {
			const remove = removeListeners.pop();
			try {
				remove?.();
			} catch {
				/* empty */
			}
		}
	};
}

async function getOAuthToken(
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	retrieveTokenWebview: WebviewTag
): Promise<string> {
	ensureDesktopEnvironment();
	const webview = retrieveTokenWebview as TestableWebview;
	const OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
	const CONSENT_REDIRECT_PREFIX = OAUTH_URL;
	const GOOGLE_EMAIL = plugin.settings.email;
	let devToolsOpened = false;
	let stepOneDisplayed = false;
	let autoRetrievalStarted = false;
	let finished = false;
	let lastNavigationUrl: string | undefined;
	let consecutiveUrlReadFailures = 0;
	let promiseResolved = false;
	const partitionAttribute = retrieveTokenWebview.getAttribute?.("partition") ?? undefined;
	logSessionEvent("info", "Starting OAuth token retrieval process", {
		email: GOOGLE_EMAIL,
		existingToken: Boolean(plugin.settings.token),
		partition: partitionAttribute,
	});
	logSessionEvent("debug", "Loading OAuth URL", { url: OAUTH_URL });
	console.debug("Starting OAuth token retrieval process...");
	console.debug("Loading OAuth URL...");
	const executeJavaScriptSafely = async <T = unknown>(
		script: string,
		label: string
	): Promise<T> => {
		logSessionEvent("debug", "Executing script inside OAuth webview", { label });
		try {
			const result = (await retrieveTokenWebview.executeJavaScript(script)) as T;
			logSessionEvent("debug", "Script executed successfully", {
				label,
				resultType: typeof result,
			});
			return result;
		} catch (error) {
			logErrorIfNotTest("Failed to run script inside OAuth webview", error);
			logSessionEvent("error", "Script execution inside OAuth webview failed", {
				label,
				errorMessage: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};
	const showGuideStep = (
		step: number,
		title: string,
		message: string,
		listItems: string[] = []
	) => {
		settingsTab.updateRetrieveTokenInstructions(step, title, message, listItems);
	};
	const updateGuideStatus = (
		message: string,
		type: "info" | "success" | "warning" | "error" = "info"
	) => {
		settingsTab.updateRetrieveTokenStatus(message, type);
	};

	showGuideStep(
		1,
		"Log in with Google",
		"Sign in with the Google account you use for Keep. The login page loads inside the panel to the right."
	);
	updateGuideStatus("Loading Google login page…", "info");

	const createButtonClickDetectionScript = (buttonText: string[]): string => {
		const searchTerms = buttonText.map((text) =>
			sanitizeForJS(sanitizeInput(text.toLowerCase()))
		);
		return String.raw`
			(function() {
				const searchTerms = ${JSON.stringify(searchTerms)};
				const selectors = ['button', 'div[role="button"]', 'span[role="button"]', 'a[role="button"]'];
				const whitespaceRegex = new RegExp(String.fromCharCode(92) + 's+', 'g');
				const normalise = (node) => {
					if (!node) {
						return '';
					}
					const rawText = (node.innerText || node.textContent || '').toLowerCase();
					return rawText ? rawText.replace(whitespaceRegex, ' ').trim() : '';
				};
				const matches = (node) => {
					if (!node) {
						return false;
					}
					const text = normalise(node);
					return searchTerms.some((term) => text.includes(term));
				};
				const attach = (node) => {
					console.log('Found button.');
					node.addEventListener('click', () => console.log('buttonClicked'), { capture: true });
				};
				const find = () => {
					for (const selector of selectors) {
						const candidate = Array.from(document.querySelectorAll(selector)).find(matches);
						if (candidate) {
							return candidate;
						}
					}
					return null;
				};

				const initial = find();
				if (initial) {
					attach(initial);
					return;
				}

				console.log('Consent button not ready. Observing for changes.');
				const observer = new MutationObserver(() => {
					const candidate = find();
					if (candidate) {
						attach(candidate);
						observer.disconnect();
					}
				});
				observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
			})();
		`;
	};

	const enterEmailScript = (email: string): string => `
        (function() {
            const emailInput = document.querySelector('input[type="email"]');
            if (emailInput) {
                emailInput.value = '${sanitizeForJS(sanitizeInput(email))}';
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                emailInput.focus();
                return true;
            }
            return false;
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

	const stepTwoListItems = [
		"Review Google's terms displayed in the consent screen.",
		'Click the button labelled "I agree" to continue.',
	];

	const stepThreeListItems = [
		"In the Developer Tools window, navigate to the Application tab.",
		"Expand Cookies in the sidebar and choose google.com.",
		'Select the cookie named "oauth_token" and copy its value.',
		"Paste the copied value back into KeepSidian to finish.",
	];

	let finalizeToken: ((token: string) => Promise<void>) | null = null;

	const tryAutomaticRetrievalOnce = async (): Promise<string | undefined> => {
		logSessionEvent("debug", "Running automatic oauth_token strategies", {
			finished,
		});
		const strategies: Array<{
			name: string;
			runner: () => Promise<string | undefined>;
		}> = [
			{
				name: "electron-partition-cookie",
				runner: async () => readOauthTokenFromPartition("persist:keepsidian"),
			},
		];

		for (const strategy of strategies) {
			if (finished) {
				return undefined;
			}
			try {
				logSessionEvent("debug", "Attempting automatic oauth_token strategy", {
					strategy: strategy.name,
				});
				const token = await strategy.runner();
				if (token) {
					logSessionEvent("info", "Automatic oauth_token strategy succeeded", {
						strategy: strategy.name,
						tokenSample: redactToken(token),
					});
					return token;
				}
				logSessionEvent("debug", "Automatic oauth_token strategy yielded no token", {
					strategy: strategy.name,
				});
			} catch (error) {
				logErrorIfNotTest("Automatic oauth_token strategy threw", error);
				logSessionEvent("error", "Automatic oauth_token strategy threw", {
					strategy: strategy.name,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return undefined;
	};

	const attemptAutomaticRetrieval = async () => {
		const deadline = Date.now() + 60000;
		let attemptCount = 0;
		logSessionEvent("info", "Starting automatic oauth_token polling", {
			deadlineInMs: 60000,
		});
		while (!finished && Date.now() < deadline) {
			if (promiseResolved) {
				logSessionEvent("debug", "Stopping automatic polling after promise resolved", {
					attempt: attemptCount,
				});
				break;
			}
			attemptCount += 1;
			logSessionEvent("debug", "Automatic polling iteration", {
				attempt: attemptCount,
				remainingMs: deadline - Date.now(),
			});
			const token = await tryAutomaticRetrievalOnce();
			if (token) {
				updateGuideStatus("Retrieved the oauth_token automatically.", "success");
				if (finalizeToken) {
					await finalizeToken(token);
				}
				logSessionEvent("info", "Automatic polling captured oauth_token", {
					attempt: attemptCount,
					outcome: "success",
					tokenSample: redactToken(token),
				});
				return;
			}
			if (promiseResolved) {
				logSessionEvent("debug", "Breaking automatic polling loop after success", {
					attempt: attemptCount,
				});
				break;
			}
			await delay(1500);
		}
		if (!finished) {
			updateGuideStatus(
				"We couldn't capture the token automatically. Use the steps above to copy it from DevTools.",
				"warning"
			);
			logSessionEvent("warn", "Automatic oauth_token polling timed out", {
				attempts: attemptCount,
			});
		}
	};

	const openDevToolsFlow = async () => {
		if (finished) {
			logSessionEvent("debug", "openDevToolsFlow invoked after finish flag", {
				devToolsOpened,
			});
			return;
		}
		if (devToolsOpened) {
			if (!autoRetrievalStarted) {
				autoRetrievalStarted = true;
				logSessionEvent("info", "Automatic polling triggered from DevTools flow");
				void attemptAutomaticRetrieval();
			}
			logSessionEvent("debug", "DevTools already open. Skipping reopening.");
			return;
		}
		devToolsOpened = true;
		logSessionEvent("info", "Opening DevTools for manual oauth_token capture");
		showGuideStep(
			3,
			"Retrieve the oauth_token cookie",
			"We're opening Chrome DevTools in a separate window. If they don't appear automatically, open them manually and follow the checklist.",
			stepThreeListItems
		);
		updateGuideStatus("Opening DevTools… this can take a few seconds.", "info");

		let devtoolsOpenedSuccessfully = false;
		try {
			if (typeof retrieveTokenWebview.openDevTools === "function") {
				retrieveTokenWebview.openDevTools();
				devtoolsOpenedSuccessfully = true;
			}
		} catch (error) {
			logErrorIfNotTest("Unable to open webview DevTools", error);
			logSessionEvent("error", "Unable to open webview DevTools", {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		}

		if (devtoolsOpenedSuccessfully) {
			updateGuideStatus(
				"DevTools should now be visible. Follow the steps on the left or wait for KeepSidian to capture the token automatically.",
				"info"
			);
		} else {
			updateGuideStatus(
				"DevTools didn't open automatically. Use Obsidian's menu (View → Toggle Developer Tools) and follow the checklist.",
				"warning"
			);
		}

		if (finished) {
			return;
		}

		const immediateToken = await tryAutomaticRetrievalOnce();
		if (immediateToken) {
			updateGuideStatus("Retrieved the oauth_token automatically.", "success");
			if (finalizeToken) {
				await finalizeToken(immediateToken);
			}
			return;
		}

		try {
			await executeJavaScriptSafely(
				createDevToolsInstructionsScript(),
				"inject-devtools-instructions"
			);
		} catch (error) {
			logErrorIfNotTest("Failed injecting DevTools overlay", error);
		}

		if (finished) {
			return;
		}

		if (!autoRetrievalStarted) {
			autoRetrievalStarted = true;
			void attemptAutomaticRetrieval();
		}
	};

	return new Promise((resolve, reject) => {
		let intervalId: ReturnType<typeof setInterval> | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let cleanupCalled = false;
		let messageHandler: ((event: ConsoleMessageEvent) => Promise<void>) | null = null;
		let removeOAuthHandlers: RemoveListener | undefined;
		let removeCookieWatcher: RemoveListener | undefined;
		let removeWebRequestWatcher: RemoveListener | undefined;

		const cleanup = () => {
			if (cleanupCalled) {
				logSessionEvent("debug", "Cleanup skipped; already executed");
				return;
			}
			logSessionEvent("debug", "Running retrieval cleanup handlers", {
				hasInterval: Boolean(intervalId),
				hasTimeout: Boolean(timeoutId),
				hasMessageHandler: Boolean(messageHandler),
				hasOAuthHandlers: Boolean(removeOAuthHandlers),
				hasCookieWatcher: Boolean(removeCookieWatcher),
				hasWebRequestWatcher: Boolean(removeWebRequestWatcher),
			});
			if (intervalId !== undefined) {
				clearInterval(intervalId);
				intervalId = undefined;
			}
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
			if (messageHandler) {
				retrieveTokenWebview.removeEventListener(
					"console-message",
					messageHandler as unknown as EventListener
				);
				messageHandler = null;
			}
			if (removeOAuthHandlers) {
				try {
					removeOAuthHandlers();
					logSessionEvent("debug", "Removed OAuth handlers");
				} catch (error) {
					logSessionEvent("warn", "Failed to remove OAuth handlers", {
						errorMessage: error instanceof Error ? error.message : String(error),
					});
				}
				removeOAuthHandlers = undefined;
			}
			if (removeCookieWatcher) {
				try {
					removeCookieWatcher();
					logSessionEvent("debug", "Removed oauth_token cookie watcher");
				} catch (error) {
					logSessionEvent("warn", "Failed to remove cookie watcher", {
						errorMessage: error instanceof Error ? error.message : String(error),
					});
				}
				removeCookieWatcher = undefined;
			}
			if (removeWebRequestWatcher) {
				try {
					removeWebRequestWatcher();
				} catch (error) {
					logSessionEvent("warn", "Failed to remove webRequest watcher", {
						errorMessage: error instanceof Error ? error.message : String(error),
					});
				}
				removeWebRequestWatcher = undefined;
			}
		const attemptCloseDevTools = () => {
			let closed = false;
			try {
				if (typeof webview.closeDevTools === "function") {
					webview.closeDevTools();
					closed = true;
				}
			} catch (error) {
				logSessionEvent("warn", "Failed to close webview DevTools via element", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
			if (!closed) {
				try {
					const electron = resolveElectron();
					const contents = electron?.webContents?.fromId?.(
						typeof webview.getWebContentsId === "function"
							? webview.getWebContentsId()
							: -1
					);
					if (contents && typeof contents.closeDevTools === "function") {
						contents.closeDevTools();
						closed = true;
					}
				} catch (error) {
					logSessionEvent("warn", "Failed to close webview DevTools via webContents", {
						errorMessage: error instanceof Error ? error.message : String(error),
					});
				}
			}
			if (closed) {
				logSessionEvent("debug", "Closed webview DevTools during cleanup");
				devToolsOpened = false;
			}
		};
		if (devToolsOpened) {
			attemptCloseDevTools();
		}
			finalizeToken = null;
			cleanupCalled = true;
		};

		const handleTokenFromWatcher = async (token: string, source: string) => {
			if (promiseResolved || finished) {
				logSessionEvent("debug", "Token watcher fired after completion", {
					source,
					tokenSample: redactToken(token),
					promiseResolved,
					finished,
				});
				return;
			}
			try {
				updateGuideStatus("Retrieved the oauth_token automatically.", "success");
				if (finalizeToken) {
					await finalizeToken(token);
				}
				logSessionEvent("info", "Handled oauth_token from watcher", {
					source,
					tokenSample: redactToken(token),
				});
			} catch (error) {
				logErrorIfNotTest("Failed to process oauth_token from watcher", error);
				logSessionEvent("error", "Failed to process oauth_token from watcher", {
					source,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		};

		const wrappedReject = (error: Error) => {
			if (promiseResolved) {
				logSessionEvent("debug", "Ignoring token retrieval rejection after success", {
					errorMessage: error.message,
				});
				return;
			}
			if (!finished) {
				finished = true;
			}
			logSessionEvent("error", "Token retrieval failed", {
				errorMessage: error.message,
			});
			updateGuideStatus(`Token retrieval failed: ${error.message}`, "error");
			cleanup();
			void endRetrievalWizardSession("error", {
				reason: error.message,
			});
			reject(error);
		};

		const finishWithToken = async (oauthToken: string) => {
			if (finished) {
				logSessionEvent("debug", "finishWithToken invoked after completion", {
					tokenSample: redactToken(oauthToken),
				});
				return;
			}
			finished = true;
			try {
				logSessionEvent("info", "Exchanging oauth_token with server", {
					tokenSample: redactToken(oauthToken),
				});
				await exchangeOauthToken(settingsTab, plugin, oauthToken);
				cleanup();
				logSessionEvent("info", "Token exchange complete", {
					tokenSample: redactToken(oauthToken),
				});
				void endRetrievalWizardSession("success", {
					tokenSample: redactToken(oauthToken),
				});
				promiseResolved = true;
				if (webview.closeDevTools) {
					try {
						webview.closeDevTools();
					} catch {
						/* empty */
					}
				}
				if (webview.hide) {
					try {
						webview.hide();
					} catch {
						/* empty */
					}
				} else {
					try {
						webview.classList.add(HIDDEN_CLASS);
					} catch {
						/* empty */
					}
				}
				showGuideStep(
					3,
					"Token captured",
					"You're all set. KeepSidian saved the oauth_token. You can close the DevTools window now."
				);
				updateGuideStatus("Token stored successfully.", "success");
				resolve(oauthToken);
			} catch (error) {
				wrappedReject(error as Error);
			}
		};

		finalizeToken = finishWithToken;

		void (async () => {
			logSessionEvent("debug", "Attempting to attach oauth_token cookie watcher", {
				partition: partitionAttribute,
			});
			const cookieWatcherCleanup = await attachPartitionCookieWatcher(
				partitionAttribute,
				(token, source) => {
					void handleTokenFromWatcher(token, source);
				}
			);
			if (cookieWatcherCleanup) {
				removeCookieWatcher = cookieWatcherCleanup;
			} else {
				logSessionEvent("info", "oauth_token cookie watcher inactive", {
					partition: partitionAttribute,
				});
			}
			logSessionEvent("debug", "Attempting to attach oauth_token webRequest watcher", {
				partition: partitionAttribute,
			});
			const webRequestWatcherCleanup = await attachWebRequestWatcher(
				partitionAttribute,
				(token, source) => {
					void handleTokenFromWatcher(token, source);
				}
			);
			if (webRequestWatcherCleanup) {
				removeWebRequestWatcher = webRequestWatcherCleanup;
			} else {
				logSessionEvent("info", "oauth_token webRequest watcher inactive", {
					partition: partitionAttribute,
				});
			}
		})();

		const handleOAuthRedirect = async () => {
			try {
				logSessionEvent("info", "Handling OAuth redirect");
				updateGuideStatus("Detected consent completion. Checking for oauth_token…", "info");
				const immediateToken = await tryAutomaticRetrievalOnce();
				if (immediateToken) {
					updateGuideStatus("Retrieved the oauth_token automatically.", "success");
					if (finalizeToken) {
						await finalizeToken(immediateToken);
					}
					return;
				}
				updateGuideStatus(
					"Trying to capture the oauth_token automatically… if that takes too long we'll open DevTools.",
					"info"
				);
				if (!autoRetrievalStarted) {
					autoRetrievalStarted = true;
					logSessionEvent(
						"info",
						"Automatic oauth_token polling initiated after consent redirect"
					);
					void attemptAutomaticRetrieval();
				}
				updateGuideStatus(
					"Opening DevTools so you can copy the oauth_token if needed…",
					"info"
				);
				await openDevToolsFlow();
			} catch (error) {
				wrappedReject(error as Error);
			}
		};

		removeOAuthHandlers = wireOAuthHandlers(
			retrieveTokenWebview,
			CONSENT_REDIRECT_PREFIX,
			() => {
				void handleOAuthRedirect();
			},
			(error) => {
				wrappedReject(error);
			},
			(url) => {
				lastNavigationUrl = url;
				consecutiveUrlReadFailures = 0;
			}
		);

		(async () => {
			try {
				/*if (typeof webview.loadURL === "function") {
					try {
						await webview.loadURL(OAUTH_URL);
					} catch (error) {
						logErrorIfNotTest("webview.loadURL failed", error);
						wrappedReject(error as Error);
						return;
					}
				} else {
					webview.src = OAUTH_URL;
				}*/
				webview.src = OAUTH_URL;
				logSessionEvent("debug", "Assigned OAuth URL to webview", { url: OAUTH_URL });
				webview.show?.();
				await waitForWebviewReady(webview);

				let emailEntered = false;
				let stepTwoDisplayed = false;

				messageHandler = async (event: ConsoleMessageEvent) => {
					try {
						const { message } = event;
						logSessionEvent("debug", "Console message captured from OAuth webview", {
							message,
						});
						if (message === "buttonClicked") {
							logSessionEvent(
								"info",
								"Detected consent button click via console log"
							);
							updateGuideStatus(
								"Consent accepted. Finishing Google authorization…",
								"info"
							);
							// The oauth redirect doesn't always trigger, so we handle it here too
							void handleOAuthRedirect();
							return;
						}
						if (message.startsWith("oauthToken: ")) {
							const oauthToken = message.split("oauthToken: ")[1];
							logSessionEvent("info", "Captured oauth_token from console log", {
								tokenSample: redactToken(oauthToken),
							});
							await finishWithToken(oauthToken);
						}
					} catch (error) {
						wrappedReject(error as Error);
					}
				};

				retrieveTokenWebview.addEventListener("console-message", messageHandler);

				const startTime = Date.now();
				const timeout = 180000;

				intervalId = setInterval(async () => {
					if (finished || promiseResolved) {
						return;
					}
					try {
						const hadCachedNavigation = Boolean(lastNavigationUrl);
						const currentUrl = lastNavigationUrl ?? (await safeGetUrl(webview));
						if (hadCachedNavigation) {
							lastNavigationUrl = undefined;
						}
						if (!currentUrl) {
							if (promiseResolved) {
								return;
							}
							if (finished) {
								return;
							}
							consecutiveUrlReadFailures += 1;
							if (consecutiveUrlReadFailures >= 3) {
								if (!finished) {
									wrappedReject(
										new Error(
											"Unable to determine the OAuth login state. Please reopen the retrieval wizard."
										)
									);
								}
							}
							return;
						}
						consecutiveUrlReadFailures = 0;

						if (!stepOneDisplayed && currentUrl.includes("accounts.google.com")) {
							logSessionEvent("info", "Detected Google login page", {
								url: summarizeUrl(currentUrl),
							});
							showGuideStep(
								1,
								"Log in with Google",
								"Enter your Google email and password in the embedded window, then continue."
							);
							updateGuideStatus("Waiting for you to sign in…", "info");
							stepOneDisplayed = true;
						}

						if (!emailEntered && currentUrl.includes("accounts.google.com")) {
							const didEnter = await executeJavaScriptSafely<boolean>(
								enterEmailScript(GOOGLE_EMAIL),
								"auto-fill-email"
							);
							emailEntered = Boolean(didEnter);
							if (emailEntered) {
								logSessionEvent("info", "Populated email field automatically");
								updateGuideStatus(
									"Login form detected. Complete any prompts to continue.",
									"info"
								);
							}
						}

						if (
							stepOneDisplayed &&
							!stepTwoDisplayed &&
							currentUrl.includes("embeddedsigninconsent")
						) {
							logSessionEvent("info", "Detected consent screen", {
								url: summarizeUrl(currentUrl),
							});
							showGuideStep(
								2,
								"Approve Google's consent screen",
								"Scroll through the consent text, then click the confirmation button to continue.",
								stepTwoListItems
							);
							updateGuideStatus(
								"Waiting for you to accept the consent form…",
								"info"
							);
							await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
							await executeJavaScriptSafely(
								createButtonClickDetectionScript(["I agree", "Acepto"]),
								"detect-consent-button"
							);
							stepTwoDisplayed = true;
						}

						if (Date.now() - startTime >= timeout) {
							logSessionEvent("error", "Retrieval interval exceeded timeout", {
								timeoutMs: timeout,
							});
							if (!finished) {
								wrappedReject(
									new Error(
										"Timeout: OAuth token retrieval process exceeded 180 seconds."
									)
								);
							}
						}
					} catch (error) {
						const normalizedError =
							error instanceof Error ? error : new Error(String(error));
						if (promiseResolved) {
							return;
						}
						if (finished) {
							return;
						}
						consecutiveUrlReadFailures += 1;
						if (normalizedError instanceof WebviewStateError) {
							updateGuideStatus(
								"The login window closed before completion. Please reopen the retrieval wizard and try again.",
								"error"
							);
							wrappedReject(normalizedError);
							return;
						}
						if (consecutiveUrlReadFailures >= 3) {
							if (!finished) {
								wrappedReject(
									new Error(
										"We lost track of the OAuth login window. Please close it and relaunch the retrieval wizard."
									)
								);
							}
							return;
						}
						logSessionEvent("debug", "Retrying after webview URL read error", {
							attempt: consecutiveUrlReadFailures,
							errorMessage: normalizedError.message,
						});
					}
				}, 1000);

				timeoutId = setTimeout(() => {
					wrappedReject(
						new Error("Timeout: OAuth token retrieval process exceeded 180 seconds.")
					);
				}, 180000);
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
	ensureDesktopEnvironment();
	try {
		logSessionEvent("info", "initRetrieveToken invoked");
		await getOAuthToken(settingsTab, plugin, retrieveTokenWebview);
		logSessionEvent("info", "initRetrieveToken completed successfully");
	} catch (error) {
		logErrorIfNotTest("Failed to retrieve token:", error);
		logSessionEvent("error", "initRetrieveToken failed", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
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
		logSessionEvent("info", "exchangeOauthToken invoked", {
			email: plugin.settings.email,
			tokenSample: redactToken(oauthToken),
		});
		try {
			logSessionEvent("debug", "Sending oauth_token to KeepSidian server", {
				endpoint: `${KEEPSIDIAN_SERVER_URL}/register`,
			});
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
				logSessionEvent("error", "Invalid token exchange response shape", {
					responseKeys: Object.keys(parsed ?? {}),
				});
				throw new Error("Invalid response format");
			}

			if (!parsed.keep_token) {
				logSessionEvent("error", "Token exchange response missing keep_token");
				throw new Error("Server response missing keep_token");
			}

			plugin.settings.token = parsed.keep_token;
			await plugin.saveSettings();
			logSessionEvent("info", "Persisted keep_token from exchange", {
				keepTokenSample: redactToken(parsed.keep_token),
			});
			settingsTab.display();
			new Notice("Token exchanged successfully.");
		} catch (e) {
			// Preserve legacy error message shape expected by tests
			if (e instanceof Error && e.message.startsWith("Server returned status")) {
				throw e;
			}
			logSessionEvent("error", "Failed to parse server response during token exchange", {
				errorMessage: e instanceof Error ? e.message : String(e),
			});
			throw new Error("Failed to parse server response: " + e);
		}
	} catch (error) {
		logErrorIfNotTest("Error exchanging OAuth token:", error);
		logSessionEvent("error", "Error exchanging OAuth token", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		new Notice(`Failed to exchange OAuth token: ${(error as Error).message}`);
		throw error;
	}
}
