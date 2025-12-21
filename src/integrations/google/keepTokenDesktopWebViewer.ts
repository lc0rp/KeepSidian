import type KeepSidianPlugin from "main";
import type {
	WebviewTag,
	ConsoleMessageEvent,
	CookiesGetFilter,
	Cookie,
	WebRequest,
	OnHeadersReceivedListenerDetails,
	HeadersReceivedResponse,
} from "electron";
import type { WorkspaceLeaf, View } from "obsidian";
import type { KeepSidianSettingsTab } from "ui/settings/KeepSidianSettingsTab";
import { HIDDEN_CLASS } from "@app/ui-constants";
import { endRetrievalWizardSession, logRetrievalWizardEvent } from "./retrievalSessionLogger";

type WebRequestWithRemoval = WebRequest & {
	removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
	off?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type CookieSession = {
	cookies?: {
		get?: (filter: CookiesGetFilter) => Promise<Cookie[]>;
		on?: (event: string, listener: (...args: unknown[]) => void) => void;
		removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
	};
	webRequest?: WebRequestWithRemoval;
};

type WebContentsLike = {
	session?: CookieSession;
	getUserAgent?: () => string;
};

type WorkspaceLike = {
	getLeavesOfType?: (type: string) => WorkspaceLeaf[];
	getLeaf?: (split?: string) => WorkspaceLeaf;
	revealLeaf?: (leaf: WorkspaceLeaf) => void;
	setActiveLeaf?: (leaf: WorkspaceLeaf, active?: boolean, pushHistory?: boolean) => void;
};

type WebviewerView = View & {
	containerEl?: HTMLElement;
	webviewEl?: WebviewTag;
};

declare global {
	interface Window {
		require: <T = unknown>(module: string) => T;
	}
}

const OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
const CONSENT_REDIRECT_PREFIX = OAUTH_URL;
const DEFAULT_PARTITION = "persist:keepsidian";
const FALLBACK_MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FALLBACK_WINDOWS_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FALLBACK_LINUX_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const sanitizeUserAgent = (value: string | undefined) => {
	if (!value) {
		return "";
	}
	return value.replace(/\s?Electron\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
};

const resolveOsFamily = () => {
	try {
		const platform = typeof process !== "undefined" ? process.platform : "";
		if (platform === "darwin") {
			return "mac";
		}
		if (platform === "win32") {
			return "windows";
		}
		if (platform === "linux") {
			return "linux";
		}
	} catch {
		// no-op
	}
	return "windows";
};

const buildUserAgent = (webview?: TestableWebview) => {
	try {
		if (webview?.getWebContents) {
			const ua = webview.getWebContents()?.getUserAgent?.();
			const trimmed = sanitizeUserAgent(ua);
			if (trimmed.length > 0) {
				return trimmed;
			}
		}
	} catch {
		// no-op
	}
	try {
		const electron = resolveElectron();
		const ua = electron?.session?.defaultSession?.getUserAgent?.();
		const trimmed = sanitizeUserAgent(ua);
		if (trimmed.length > 0) {
			return trimmed;
		}
	} catch {
		// no-op
	}
	const osFamily = resolveOsFamily();
	if (osFamily === "mac") {
		return FALLBACK_MAC_UA;
	}
	if (osFamily === "windows") {
		return FALLBACK_WINDOWS_UA;
	}
	if (osFamily === "linux") {
		return FALLBACK_LINUX_UA;
	}
	return FALLBACK_WINDOWS_UA;
};

function logErrorIfNotTest(...args: unknown[]) {
	try {
		const isTest =
			typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
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

let consoleDebugEnabled = false;

const shouldLogDebugToConsole = () => {
	if (!consoleDebugEnabled) {
		return false;
	}
	try {
		return !(
			typeof process !== "undefined" &&
			(process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID)
		);
	} catch {
		return false;
	}
};

const logSessionEvent = (
	level: "info" | "warn" | "error" | "debug",
	message: string,
	metadata: Record<string, unknown> = {}
) => {
	void logRetrievalWizardEvent(level, message, metadata);
	if (!shouldLogDebugToConsole()) {
		return;
	}
	const payload = Object.keys(metadata).length ? metadata : undefined;
	switch (level) {
		case "error":
			console.error("[KeepSidian OAuth]", message, payload);
			break;
		case "warn":
			console.warn("[KeepSidian OAuth]", message, payload);
			break;
		case "info":
			console.info("[KeepSidian OAuth]", message, payload);
			break;
		default:
			console.debug("[KeepSidian OAuth]", message, payload);
	}
};

const logDebugToConsole = (message: string, metadata?: Record<string, unknown>) => {
	if (!shouldLogDebugToConsole()) {
		return;
	}
	const payload = metadata && Object.keys(metadata).length ? metadata : undefined;
	console.debug("[KeepSidian OAuth]", message, payload);
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

type TestableWebview = WebviewTag & {
	loadURL?: (url: string) => Promise<void> | void;
	src?: string;
	show?: () => void;
	hide?: () => void;
	closeDevTools?: () => void;
	openDevTools?: () => void;
	getURL?: () => string;
	isDestroyed?: () => boolean;
	getWebContents?: () => WebContentsLike | undefined;
	getWebContentsId?: () => number;
	setUserAgent?: (userAgent: string) => void;
};

class WebviewStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebviewStateError";
	}
}

const webviewUrlErrorLogMap = new WeakMap<WebviewTag, number>();
type OauthTokenHandler = (token: string) => Promise<void>;
type RemoveListener = () => void;
type OverlayStatusType = "info" | "success" | "warning" | "error";
type OverlayState = {
	step?: number;
	title?: string;
	message?: string;
	listItems?: string[];
	statusMessage?: string;
	statusType?: OverlayStatusType;
};

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
		const globalScope =
			(Function("return this")() as {
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

const mergeWebPreferences = (existing: string | null, additions: string[]): string => {
	const parts = (existing ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const normalized = new Set(parts.map((value) => value.toLowerCase()));
	for (const addition of additions) {
		const trimmed = addition.trim();
		if (!trimmed) {
			continue;
		}
		if (!normalized.has(trimmed.toLowerCase())) {
			parts.push(trimmed);
			normalized.add(trimmed.toLowerCase());
		}
	}
	return parts.join(",");
};

const configureWebviewForOAuth = (webview: WebviewTag, partition: string, userAgent: string): string => {
	let resolvedPartition = partition;
	try {
		const currentPartition = webview.getAttribute?.("partition") ?? undefined;
		if (currentPartition) {
			resolvedPartition = currentPartition;
		} else {
			try {
				webview.setAttribute("partition", partition);
				resolvedPartition = partition;
			} catch (error) {
				logSessionEvent("warn", "Unable to set webview partition (likely already navigated)", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		}
		webview.setAttribute("allowpopups", "true");
		webview.setAttribute("disablewebsecurity", "true");
		webview.setAttribute("disableblinkfeatures", "AutomationControlled");
		const existingPreferences = webview.getAttribute?.("webpreferences") ?? null;
		const mergedPreferences = mergeWebPreferences(existingPreferences, [
			"contextIsolation=yes",
			"nativeWindowOpen=yes",
			"sandbox=no",
			"webSecurity=no",
			"disableBlinkFeatures=AutomationControlled",
		]);
		if (mergedPreferences) {
			webview.setAttribute("webpreferences", mergedPreferences);
		}
		if (userAgent) {
			webview.setAttribute("useragent", userAgent);
			const testable = webview as TestableWebview;
			if (typeof testable.setUserAgent === "function") {
				try {
					testable.setUserAgent(userAgent);
				} catch (error) {
					logSessionEvent("warn", "Failed to set webview user agent", {
						errorMessage: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}
	} catch (error) {
		logErrorIfNotTest("Failed configuring webview attributes", error);
		logSessionEvent("warn", "Failed configuring webview attributes", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
	return webview.getAttribute?.("partition") ?? resolvedPartition;
};

const applyStealthFixes = async (webview: WebviewTag) => {
	const script = `
		(function() {
			try {
				Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
			} catch (e) {}
			try {
				window.chrome = window.chrome || { runtime: {} };
			} catch (e) {}
			try {
				Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
			} catch (e) {}
			try {
				Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
			} catch (e) {}
		})();
	`;
	try {
		await webview.executeJavaScript(script, true);
		logSessionEvent("debug", "Applied anti-automation script");
	} catch (error) {
		logSessionEvent("warn", "Failed applying anti-automation script", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
};

const resolveSessionForWebview = (webview: WebviewTag) => {
	const testable = webview as TestableWebview;
	const partition = webview.getAttribute?.("partition") ?? undefined;
	const electron = resolveElectron();
	if (typeof testable.getWebContents === "function") {
		const contents = testable.getWebContents();
		if (contents?.session) {
			return { session: contents.session, source: "webcontents", partition };
		}
	}
	if (typeof testable.getWebContentsId === "function" && electron?.webContents?.fromId) {
		const id = testable.getWebContentsId();
		const contents = electron.webContents.fromId(id) as WebContentsLike | undefined;
		if (contents?.session) {
			return { session: contents.session, source: "webcontents-id", partition };
		}
	}
	if (partition && electron?.session?.fromPartition) {
		const session = electron.session.fromPartition(partition) as CookieSession | undefined;
		if (session) {
			return { session, source: "partition", partition };
		}
	}
	if (electron?.session?.defaultSession) {
		return {
			session: electron.session.defaultSession as CookieSession,
			source: "default",
			partition,
		};
	}
	return { session: undefined, source: "unavailable", partition };
};

function extractOauthTokenFromHeaderValue(value: string): string | undefined {
	const match = value.match(/oauth_token=([^;]+)/i);
	return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

async function attachSessionCookieWatcher(
	session: CookieSession | undefined,
	onToken: (token: string, source: string) => void
): Promise<RemoveListener | undefined> {
	if (!session?.cookies?.on || !session.cookies.removeListener) {
		logSessionEvent("info", "Session cookie watcher unavailable");
		return undefined;
	}
	try {
		const listener = (_event: unknown, cookie: Cookie, cause: string, removed: boolean) => {
			try {
				if (removed) {
					return;
				}
				if (cookie?.name === "oauth_token" && cookie.value) {
					logSessionEvent("info", "Detected oauth_token cookie via session watcher", {
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
		session.cookies.on("changed", listener as unknown as (...args: unknown[]) => void);
		logSessionEvent("info", "Attached oauth_token session cookie watcher");
		return () => {
			try {
				session.cookies?.removeListener?.("changed", listener as unknown as (...args: unknown[]) => void);
				logSessionEvent("debug", "Removed oauth_token session cookie watcher");
			} catch (error) {
				logSessionEvent("warn", "Failed removing oauth_token session cookie watcher", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		};
	} catch (error) {
		logErrorIfNotTest("Unable to attach oauth_token cookie watcher", error);
		logSessionEvent("error", "Unable to attach oauth_token cookie watcher", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

async function attachSessionWebRequestWatcher(
	session: CookieSession | undefined,
	onToken: (token: string, source: string) => void
): Promise<RemoveListener | undefined> {
	if (!session?.webRequest?.onHeadersReceived) {
		logSessionEvent("info", "Session webRequest watcher unavailable");
		return undefined;
	}
	try {
		const webRequest = session.webRequest;
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
		logSessionEvent("info", "Attached oauth_token webRequest watcher");
		return () => {
			try {
				if (typeof webRequest?.removeListener === "function") {
					webRequest.removeListener("headers-received", listener as unknown as (...args: unknown[]) => void);
				} else if (typeof webRequest?.off === "function") {
					webRequest.off("headers-received", listener as unknown as (...args: unknown[]) => void);
				}
				logSessionEvent("debug", "Removed oauth_token webRequest watcher");
			} catch (error) {
				logSessionEvent("warn", "Failed removing oauth_token webRequest watcher", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		};
	} catch (error) {
		logErrorIfNotTest("Unable to attach oauth_token webRequest watcher", error);
		logSessionEvent("error", "Unable to attach oauth_token webRequest watcher", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

async function readOauthTokenFromSession(session: CookieSession | undefined): Promise<string | undefined> {
	if (!session?.cookies?.get) {
		return undefined;
	}
	const filters: CookiesGetFilter[] = [
		{},
		{ name: "oauth_token" },
		{ domain: ".google.com", name: "oauth_token" },
		{ domain: "google.com", name: "oauth_token" },
		{ domain: "accounts.google.com", name: "oauth_token" },
		{ url: "https://accounts.google.com", name: "oauth_token" },
		{ url: "https://keep.google.com", name: "oauth_token" },
	];
	for (const filter of filters) {
		try {
			logSessionEvent("debug", "Checking session cookies", {
				filter,
			});
			const cookies = await session.cookies.get(filter);
			const match = cookies?.find((cookie) => cookie.name === "oauth_token" && !!cookie.value);
			if (match?.value) {
				logSessionEvent("info", "Found oauth_token cookie in session", {
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
	logSessionEvent("debug", "oauth_token cookie not found in session");
	return undefined;
}

async function readOauthTokenFromPartition(partition: string): Promise<string | undefined> {
	try {
		logSessionEvent("debug", "Reading oauth_token from partition", { partition });
		const electron = resolveElectron();
		if (!electron?.session?.fromPartition) {
			return undefined;
		}
		const partitionSession = electron.session.fromPartition(partition);
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
				const match = cookies?.find((cookie) => cookie.name === "oauth_token" && !!cookie.value);
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

async function readOauthTokenFromDocument(webview: WebviewTag): Promise<string | undefined> {
	try {
		const cookieString = await webview.executeJavaScript("document.cookie", true);
		if (typeof cookieString !== "string" || cookieString.length === 0) {
			return undefined;
		}
		const match = cookieString.match(/oauth_token=([^;]+)/i);
		if (match?.[1]) {
			const token = decodeURIComponent(match[1]);
			logSessionEvent("info", "Found oauth_token via document.cookie", {
				tokenSample: redactToken(token),
			});
			return token;
		}
	} catch (error) {
		logSessionEvent("warn", "Failed reading document.cookie for oauth_token", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
	return undefined;
}

const delay = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const buildOverlayScript = (state: OverlayState) => {
	const payload = JSON.stringify(state);
	return `
		(function() {
			const data = ${payload};
			const overlayId = 'keepsidian-oauth-overlay';
			let overlay = document.getElementById(overlayId);
			if (!overlay) {
				overlay = document.createElement('div');
				overlay.id = overlayId;
				overlay.setAttribute(
					'style',
					'position:fixed;top:14px;right:14px;z-index:2147483647;background:rgba(18,20,28,0.92);color:#fff;' +
						'border-radius:12px;padding:12px 14px;max-width:320px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
						'font-size:12px;line-height:1.35;box-shadow:0 12px 30px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.12);' +
						'pointer-events:auto;'
				);
				overlay.innerHTML =
					'<div id="keepsidian-oauth-overlay-title" style="font-weight:600;margin-bottom:6px;"></div>' +
					'<div id="keepsidian-oauth-overlay-message" style="margin-bottom:8px;"></div>' +
					'<ol id="keepsidian-oauth-overlay-list" style="margin:0 0 8px 18px;padding:0;"></ol>' +
					'<div id="keepsidian-oauth-overlay-status" style="font-weight:600;"></div>';
				(document.body || document.documentElement).appendChild(overlay);
			}

			const titleEl = overlay.querySelector('#keepsidian-oauth-overlay-title');
			const messageEl = overlay.querySelector('#keepsidian-oauth-overlay-message');
			const listEl = overlay.querySelector('#keepsidian-oauth-overlay-list');
			const statusEl = overlay.querySelector('#keepsidian-oauth-overlay-status');

			const titleText = data.title || '';
			const messageText = data.message || '';
			const items = Array.isArray(data.listItems) ? data.listItems : [];
			const statusText = data.statusMessage || '';

			if (titleEl) titleEl.textContent = titleText;
			if (messageEl) messageEl.textContent = messageText;

			if (listEl) {
				while (listEl.firstChild) {
					listEl.removeChild(listEl.firstChild);
				}
				if (items.length > 0) {
					items.forEach((item) => {
						const li = document.createElement('li');
						li.textContent = String(item);
						listEl.appendChild(li);
					});
					listEl.style.display = 'block';
				} else {
					listEl.style.display = 'none';
				}
			}

			if (statusEl) {
				statusEl.textContent = statusText;
				const statusType = data.statusType || 'info';
				let color = '#93c5fd';
				if (statusType === 'success') color = '#86efac';
				if (statusType === 'warning') color = '#fde047';
				if (statusType === 'error') color = '#fca5a5';
				statusEl.style.color = statusText ? color : '#93c5fd';
				statusEl.style.display = statusText ? 'block' : 'none';
			}

			if (!titleText && !messageText && items.length === 0 && !statusText) {
				overlay.style.display = 'none';
			} else {
				overlay.style.display = 'block';
			}
		})();
	`;
};

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
			path.includes("success") || path.includes("complete") || path.includes("done") || path.includes("finish");
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

	bind(wv, "did-redirect-navigation", redirectHandler);
	bind(wv, "did-navigate", redirectHandler);
	bind(wv, "did-navigate-in-page", redirectHandler);

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

type WebViewerHandle = {
	leaf: WorkspaceLeaf;
	webview: WebviewTag;
	created: boolean;
	cleanup: () => void;
};

const ensureWebViewerEnabled = async (plugin: KeepSidianPlugin) => {
	const appWithInternal = plugin.app as {
		internalPlugins?: {
			getPluginById?: (id: string) => { enabled?: boolean; enable?: () => Promise<void> | void };
			plugins?: Map<string, { enabled?: boolean; enable?: () => Promise<void> | void }>;
		};
	};
	const internalPlugins = appWithInternal.internalPlugins;
	const candidate = internalPlugins?.getPluginById?.("webviewer") ?? internalPlugins?.plugins?.get?.("webviewer");
	if (candidate && candidate.enabled === false && typeof candidate.enable === "function") {
		try {
			await candidate.enable();
			logSessionEvent("info", "Enabled core Web Viewer plugin");
		} catch (error) {
			logSessionEvent("warn", "Failed to enable core Web Viewer plugin", {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		}
	}
};

const findWebviewInLeaf = (leaf: WorkspaceLeaf): WebviewTag | undefined => {
	const view = leaf.view as WebviewerView | undefined;
	const direct = view?.webviewEl;
	if (direct && direct.tagName?.toLowerCase() === "webview") {
		return direct;
	}
	const container = view?.containerEl ?? (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
	if (!container) {
		return undefined;
	}
	const candidate = container.querySelector("webview");
	if (candidate && candidate instanceof HTMLElement) {
		return candidate as WebviewTag;
	}
	return undefined;
};

const waitForWebviewInLeaf = (leaf: WorkspaceLeaf, timeoutMs = 20000) =>
	new Promise<WebviewTag>((resolve, reject) => {
		const existing = findWebviewInLeaf(leaf);
		if (existing) {
			resolve(existing);
			return;
		}
		const started = Date.now();
		const interval = setInterval(() => {
			const found = findWebviewInLeaf(leaf);
			if (found) {
				clearInterval(interval);
				clearTimeout(timeout);
				resolve(found);
				return;
			}
			if (Date.now() - started > timeoutMs) {
				clearInterval(interval);
				clearTimeout(timeout);
				reject(new Error("Timed out waiting for Web Viewer webview"));
			}
		}, 200);
		const timeout = setTimeout(() => {
			clearInterval(interval);
			reject(new Error("Timed out waiting for Web Viewer webview"));
		}, timeoutMs);
	});

const focusLeaf = (plugin: KeepSidianPlugin, leaf: WorkspaceLeaf) => {
	const workspace = plugin.app.workspace as WorkspaceLike;
	workspace.setActiveLeaf?.(leaf, true, true);
	workspace.revealLeaf?.(leaf);
};

const closeLeaf = (leaf: WorkspaceLeaf) => {
	try {
		if (typeof (leaf as { detach?: () => void }).detach === "function") {
			(leaf as { detach: () => void }).detach();
			return;
		}
	} catch {
		// no-op
	}
	try {
		void leaf.setViewState({ type: "empty", state: {} });
	} catch {
		// no-op
	}
};

const openWebViewerForOAuth = async (plugin: KeepSidianPlugin, url: string): Promise<WebViewerHandle> => {
	await ensureWebViewerEnabled(plugin);
	const workspace = plugin.app.workspace as WorkspaceLike;
	const existingLeaf = workspace.getLeavesOfType?.("webviewer")?.[0];
	const leaf =
		existingLeaf ?? workspace.getLeaf?.("split") ?? workspace.getLeaf?.("tab") ?? workspace.getLeaf?.("window");
	if (!leaf) {
		throw new Error("Unable to open a Web Viewer leaf");
	}
	const created = !existingLeaf;
	await leaf.setViewState({
		type: "webviewer",
		state: {
			url,
			navigate: true,
		},
		active: true,
	});
	const webview = await waitForWebviewInLeaf(leaf);
	return {
		leaf,
		webview,
		created,
		cleanup: () => {
			if (created) {
				closeLeaf(leaf);
			}
		},
	};
};

type RetrievalContext = {
	webviewerLeaf?: WorkspaceLeaf;
	usingWebViewer: boolean;
};

async function getOAuthToken(
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	retrieveTokenWebview: WebviewTag,
	onOauthToken?: OauthTokenHandler,
	context: RetrievalContext = { usingWebViewer: false }
): Promise<string> {
	const webview = retrieveTokenWebview as TestableWebview;
	const GOOGLE_EMAIL = plugin.settings.email;
	let devToolsOpened = false;
	let autoRetrievalStarted = false;
	let finished = false;
	let lastNavigationUrl: string | undefined;
	let consecutiveUrlReadFailures = 0;
	let promiseResolved = false;
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let messageHandler: ((event: ConsoleMessageEvent) => void) | null = null;
	let removeCookieWatcher: RemoveListener | null = null;
	let removeWebRequestWatcher: RemoveListener | null = null;
	let removeOAuthHandlers: RemoveListener | null = null;

	const partitionAttribute = configureWebviewForOAuth(
		retrieveTokenWebview,
		DEFAULT_PARTITION,
		buildUserAgent(webview)
	);
	const sessionResolution = resolveSessionForWebview(retrieveTokenWebview);
	const cookieLogIntervalMs = 10000;
	let lastCookieLogAt = 0;

	logSessionEvent("info", "Starting OAuth token retrieval process (Web Viewer)", {
		email: GOOGLE_EMAIL,
		existingToken: Boolean(plugin.settings.token),
		partition: partitionAttribute,
		sessionSource: sessionResolution.source,
		usingWebViewer: context.usingWebViewer,
	});
	logDebugToConsole("Resolved webview partition/session", {
		partition: partitionAttribute,
		sessionSource: sessionResolution.source,
	});
	logSessionEvent("debug", "Loading OAuth URL", { url: OAUTH_URL });

	const executeJavaScriptSafely = async <T = unknown>(script: string, label: string): Promise<T> => {
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

	const overlayState: OverlayState = {};
	const updateWebViewerOverlay = (partial: OverlayState) => {
		if (!context.usingWebViewer) {
			return;
		}
		Object.assign(overlayState, partial);
		const script = buildOverlayScript(overlayState);
		void (async () => {
			try {
				await retrieveTokenWebview.executeJavaScript(script, true);
			} catch (error) {
				logSessionEvent("debug", "Failed updating Web Viewer overlay", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	};

	const logCookieSnapshot = async (label: string) => {
		if (!shouldLogDebugToConsole()) {
			return;
		}
		const now = Date.now();
		if (now - lastCookieLogAt < cookieLogIntervalMs) {
			return;
		}
		lastCookieLogAt = now;
		const electron = resolveElectron();
		const candidateSessions: Array<{ session?: CookieSession; source: string }> = [
			{ session: sessionResolution.session, source: sessionResolution.source },
		];
		if (partitionAttribute && electron?.session?.fromPartition) {
			candidateSessions.push({
				session: electron.session.fromPartition(partitionAttribute) as CookieSession,
				source: "partition",
			});
		}
		if (electron?.session?.defaultSession) {
			candidateSessions.push({
				session: electron.session.defaultSession as CookieSession,
				source: "default",
			});
		}
		const activeCandidate = candidateSessions.find((candidate) => candidate.session?.cookies?.get);
		if (!activeCandidate?.session?.cookies?.get) {
			logDebugToConsole("Cookie snapshot unavailable (no session cookies API)", {
				label,
				partition: partitionAttribute,
				sessionSource: sessionResolution.source,
			});
			return;
		}
		try {
			const cookies = await activeCandidate.session.cookies.get({});
			const sample = cookies.slice(0, 25).map((cookie) => ({
				name: cookie.name,
				domain: cookie.domain,
				path: cookie.path,
				secure: cookie.secure,
				httpOnly: cookie.httpOnly,
				session: cookie.session,
			}));
			logDebugToConsole("Cookie snapshot", {
				label,
				partition: partitionAttribute,
				sessionSource: activeCandidate.source,
				count: cookies.length,
				sample,
			});
		} catch (error) {
			logDebugToConsole("Cookie snapshot failed", {
				label,
				partition: partitionAttribute,
				sessionSource: activeCandidate.source,
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const showGuideStep = (
		step: number,
		title: string,
		message: string,
		listItems: string[] = [],
		action?: { label: string; onClick: () => void } | null
	) => {
		settingsTab.updateRetrieveTokenInstructions(step, title, message, listItems);
		settingsTab.updateRetrieveTokenAction(action ?? null);
		const headingPrefix = Number.isFinite(step) ? `Step ${step} of 3: ` : "";
		updateWebViewerOverlay({
			step,
			title: `${headingPrefix}${title}`,
			message,
			listItems,
		});
	};

	const updateGuideStatus = (message: string, type: "info" | "success" | "warning" | "error" = "info") => {
		settingsTab.updateRetrieveTokenStatus(message, type);
		updateWebViewerOverlay({
			statusMessage: message,
			statusType: type,
		});
	};

	const cleanup = () => {
		if (messageHandler) {
			try {
				retrieveTokenWebview.removeEventListener("console-message", messageHandler);
			} catch {
				// no-op
			}
		}
		if (intervalId) {
			clearInterval(intervalId);
		}
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (removeOAuthHandlers) {
			try {
				removeOAuthHandlers();
			} catch {
				// no-op
			}
		}
		if (removeCookieWatcher) {
			try {
				removeCookieWatcher();
			} catch {
				// no-op
			}
		}
		if (removeWebRequestWatcher) {
			try {
				removeWebRequestWatcher();
			} catch {
				// no-op
			}
		}
		settingsTab.updateRetrieveTokenAction(null);
	};

	const showWebViewerAction = context.webviewerLeaf
		? {
				label: "Show Web Viewer",
				onClick: () => {
					focusLeaf(plugin, context.webviewerLeaf!);
				},
			}
		: null;

	showGuideStep(
		1,
		"Log in with Google",
		context.usingWebViewer
			? "We opened a Web Viewer pane for Google login. Use it to sign in with your Google account."
			: "Sign in with the Google account you use for Keep. The login page loads inside the panel to the right.",
		[],
		showWebViewerAction
	);
	updateGuideStatus(
		context.usingWebViewer ? "Loading Google login page in Web Viewer…" : "Loading Google login page…",
		"info"
	);

	const createButtonClickDetectionScript = (buttonText: string[]): string => {
		const searchTerms = buttonText.map((text) => sanitizeForJS(sanitizeInput(text.toLowerCase())));
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
				name: "session-cookies",
				runner: async () => readOauthTokenFromSession(sessionResolution.session),
			},
			{
				name: "partition-cookies",
				runner: async () => (partitionAttribute ? readOauthTokenFromPartition(partitionAttribute) : undefined),
			},
			{
				name: "document-cookie",
				runner: async () => readOauthTokenFromDocument(retrieveTokenWebview),
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

	const reopenDevTools = () => {
		try {
			if (typeof retrieveTokenWebview.closeDevTools === "function") {
				retrieveTokenWebview.closeDevTools();
			}
		} catch (error) {
			logErrorIfNotTest("Unable to close webview DevTools", error);
			logSessionEvent("warn", "Unable to close webview DevTools", {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		}
		try {
			if (typeof retrieveTokenWebview.openDevTools === "function") {
				retrieveTokenWebview.openDevTools();
			}
		} catch (error) {
			logErrorIfNotTest("Unable to open webview DevTools", error);
			logSessionEvent("error", "Unable to open webview DevTools", {
				errorMessage: error instanceof Error ? error.message : String(error),
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
			stepThreeListItems,
			{
				label: "(Re)Open DevTools",
				onClick: () => {
					reopenDevTools();
				},
			}
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
			await executeJavaScriptSafely(createDevToolsInstructionsScript(), "inject-devtools-instructions");
		} catch (error) {
			logErrorIfNotTest("Failed injecting DevTools overlay", error);
		}

		if (finished) {
			return;
		}

		if (!autoRetrievalStarted) {
			autoRetrievalStarted = true;
			logSessionEvent("info", "Automatic polling triggered from DevTools flow");
			void attemptAutomaticRetrieval();
		}
	};

	return new Promise((resolve, reject) => {
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
				if (onOauthToken) {
					logSessionEvent("info", "Handling oauth_token with callback", {
						tokenSample: redactToken(oauthToken),
					});
					await onOauthToken(oauthToken);
				}
				cleanup();
				logSessionEvent("info", "Token capture complete", {
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
			const electron = resolveElectron();
			const candidateSessions: Array<{ session?: CookieSession; source: string }> = [
				{ session: sessionResolution.session, source: sessionResolution.source },
			];
			if (partitionAttribute && electron?.session?.fromPartition) {
				candidateSessions.push({
					session: electron.session.fromPartition(partitionAttribute) as CookieSession,
					source: "partition",
				});
			}
			if (electron?.session?.defaultSession) {
				candidateSessions.push({
					session: electron.session.defaultSession as CookieSession,
					source: "default",
				});
			}
			const cookieSessionCandidate = candidateSessions.find(
				(candidate) =>
					typeof candidate.session?.cookies?.on === "function" &&
					typeof candidate.session?.cookies?.removeListener === "function"
			);
			const webRequestSessionCandidate = candidateSessions.find(
				(candidate) => typeof candidate.session?.webRequest?.onHeadersReceived === "function"
			);

			logSessionEvent("debug", "Attempting to attach oauth_token cookie watcher", {
				partition: partitionAttribute,
				sessionSource: cookieSessionCandidate?.source ?? sessionResolution.source,
			});
			const cookieWatcherCleanup = await attachSessionCookieWatcher(
				cookieSessionCandidate?.session,
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
				sessionSource: webRequestSessionCandidate?.source ?? sessionResolution.source,
			});
			const webRequestWatcherCleanup = await attachSessionWebRequestWatcher(
				webRequestSessionCandidate?.session,
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
		})().catch((error) => {
			logSessionEvent("warn", "Failed to attach oauth_token watchers", {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		});

		const handleOAuthRedirect = async () => {
			try {
				logSessionEvent("info", "Handling OAuth redirect");
				updateGuideStatus("Detected consent completion. Checking for oauth_token…", "info");
				await logCookieSnapshot("redirect-detected");
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
					logSessionEvent("info", "Automatic oauth_token polling initiated after consent redirect");
					void attemptAutomaticRetrieval();
				}
				updateGuideStatus("Opening DevTools so you can copy the oauth_token if needed…", "info");
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
				retrieveTokenWebview.src = OAUTH_URL;
				logSessionEvent("debug", "Assigned OAuth URL to webview", { url: OAUTH_URL });
				retrieveTokenWebview.show?.();
				await waitForWebviewReady(retrieveTokenWebview);
				updateWebViewerOverlay({});
				await logCookieSnapshot("dom-ready");
				await applyStealthFixes(retrieveTokenWebview);

				let emailEntered = false;
				let stepOneDisplayed = true;
				let stepTwoDisplayed = false;

				messageHandler = async (event: ConsoleMessageEvent) => {
					try {
						const { message } = event;
						logSessionEvent("debug", "Console message captured from OAuth webview", {
							message,
						});
						if (message === "buttonClicked") {
							logSessionEvent("info", "Detected consent button click via console log");
							updateGuideStatus("Consent accepted. Finishing Google authorization…", "info");
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
						await logCookieSnapshot("poll");
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
							showGuideStep(
								1,
								"Log in with Google",
								context.usingWebViewer
									? "Continue signing in using the Web Viewer pane."
									: "Enter your Google email and password in the embedded window, then continue."
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
								updateGuideStatus("Login form detected. Complete any prompts to continue.", "info");
							}
						}

						if (!stepTwoDisplayed && currentUrl.includes("embeddedsigninconsent")) {
							logSessionEvent("info", "Detected consent screen", {
								url: summarizeUrl(currentUrl),
							});
							showGuideStep(
								2,
								"Approve Google's consent screen",
								"Scroll through the consent text, then click the confirmation button to continue.",
								stepTwoListItems
							);
							updateGuideStatus("Waiting for you to accept the consent form…", "info");
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
									new Error("Timeout: OAuth token retrieval process exceeded 180 seconds.")
								);
							}
							return;
						}
					} catch (error) {
						const normalizedError = error instanceof Error ? error : new Error(String(error));
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
					wrappedReject(new Error("Timeout: OAuth token retrieval process exceeded 180 seconds."));
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
	retrieveTokenWebview: WebviewTag,
	onOauthToken?: OauthTokenHandler
) {
	let webviewToUse = retrieveTokenWebview;
	let cleanupWebViewer: (() => void) | null = null;
	let webviewerLeaf: WorkspaceLeaf | undefined;
	let usingWebViewer = false;
	try {
		consoleDebugEnabled = Boolean(plugin.settings.oauthDebugMode);
		const webviewerHandle = await openWebViewerForOAuth(plugin, OAUTH_URL);
		webviewToUse = webviewerHandle.webview;
		webviewerLeaf = webviewerHandle.leaf;
		cleanupWebViewer = webviewerHandle.cleanup;
		usingWebViewer = true;
		if (retrieveTokenWebview !== webviewToUse) {
			try {
				retrieveTokenWebview.hide?.();
			} catch {
				/* empty */
			}
			try {
				retrieveTokenWebview.classList.add(HIDDEN_CLASS);
			} catch {
				/* empty */
			}
		}
	} catch (error) {
		logSessionEvent("warn", "Failed to open Web Viewer; falling back to embedded webview", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
	try {
		logSessionEvent("info", "initRetrieveToken invoked (Web Viewer)");
		await getOAuthToken(settingsTab, plugin, webviewToUse, onOauthToken, {
			webviewerLeaf,
			usingWebViewer,
		});
		logSessionEvent("info", "initRetrieveToken completed successfully");
	} catch (error) {
		logErrorIfNotTest("Failed to retrieve token:", error);
		logSessionEvent("error", "initRetrieveToken failed", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		try {
			cleanupWebViewer?.();
		} catch {
			// no-op
		}
	}
}
