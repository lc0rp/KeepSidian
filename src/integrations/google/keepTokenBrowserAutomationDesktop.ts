import fs from "fs";
import os from "os";
import path from "path";
import pcrImport from "puppeteer-chromium-resolver";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import type KeepSidianPlugin from "main";
import { logRetrievalWizardEvent } from "./retrievalSessionLogger";

type AutomationEngine = "puppeteer" | "playwright";

interface AutomationResult {
	oauth_token: string;
	engine?: string;
	url?: string;
	timestamp?: string;
}

interface AutomationOptions {
	useSystemBrowser?: boolean;
	debug?: boolean;
	timeoutMinutes?: number;
}

type LogLevel = "info" | "warn" | "error" | "debug";

type AutomationPage = {
	evaluate: <T, Arg = void>(pageFunction: (arg: Arg) => T, arg?: Arg) => Promise<T>;
	$eval: <T>(selector: string, pageFunction: (el: Element) => T) => Promise<T>;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
	url: () => string;
	goto: (url: string, options?: { waitUntil?: "domcontentloaded" | "load" }) => Promise<unknown>;
};

type CookieSnapshot = {
	name: string;
	value: string;
	domain?: string;
	path?: string;
};

type ScreenState = {
	url: string;
	title: string;
	hasEmailInput: boolean;
	hasPasswordInput: boolean;
	hasAccountChooser: boolean;
	hasSmsInput: boolean;
	hasTotpInput: boolean;
	hasSecurityKey: boolean;
	hasPrompt: boolean;
	hasBackupCode: boolean;
	hasTryAnotherWay: boolean;
	hasConsent: boolean;
	hasCaptcha: boolean;
	blocked: boolean;
	challengeOptions: string[];
};

type OverlayPayload = {
	key: string;
	title: string;
	message: string;
	steps: string[];
	status: string;
};

const DEFAULT_OAUTH_URL = "https://accounts.google.com/EmbeddedSetup";
const DEFAULT_TIMEOUT_MINUTES = 12;
const OVERLAY_ID = "keepsidian-oauth-overlay";
const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const overlayStyles = `
#${OVERLAY_ID} {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 340px;
  background: rgba(17, 24, 39, 0.94);
  color: #f9fafb;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 12px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
  z-index: 2147483647;
  padding: 12px 14px 12px 14px;
}
#${OVERLAY_ID}.minimized .ks-body {
  display: none;
}
#${OVERLAY_ID} .ks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  gap: 8px;
}
#${OVERLAY_ID} .ks-title {
  font-weight: 600;
  font-size: 14px;
}
#${OVERLAY_ID} .ks-toggle {
  background: rgba(255, 255, 255, 0.12);
  color: #f9fafb;
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 11px;
}
#${OVERLAY_ID} .ks-step {
  font-weight: 600;
  margin-bottom: 6px;
}
#${OVERLAY_ID} .ks-message {
  margin-bottom: 8px;
  color: #e5e7eb;
}
#${OVERLAY_ID} .ks-steps {
  margin: 0 0 8px 18px;
  padding: 0;
}
#${OVERLAY_ID} .ks-status {
  font-size: 11px;
  color: #cbd5f5;
  word-break: break-word;
}
`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runOauthBrowserAutomationDesktop(
	plugin: KeepSidianPlugin,
	engine: AutomationEngine,
	options: AutomationOptions = {}
): Promise<AutomationResult> {
	const debugEnabled = Boolean(options.debug);
	const timeoutMinutes = options.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
	const timeoutMs = timeoutMinutes * 60_000;
	const email = plugin.settings.email ?? "";

	const logSessionEvent = (
		level: LogLevel,
		message: string,
		metadata: Record<string, unknown> = {}
	) => {
		void logRetrievalWizardEvent(level, message, metadata);
		if (!debugEnabled) {
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

	logSessionEvent("info", "Starting in-app browser automation", {
		engine,
		emailProvided: Boolean(email),
		timeoutMinutes,
		useSystemBrowser: Boolean(options.useSystemBrowser),
	});

	if (engine === "playwright") {
		return await runPlaywrightFlow(email, timeoutMs, options, logSessionEvent);
	}

	return await runPuppeteerFlow(email, timeoutMs, logSessionEvent);
}

const ensureOverlay = async (
	page: AutomationPage,
	payload: OverlayPayload | null,
	logSessionEvent: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void
) => {
	try {
		await page.evaluate(
			({ overlayId, styles, payload }) => {
				if (!document.getElementById(`${overlayId}-style`)) {
					const style = document.createElement("style");
					style.id = `${overlayId}-style`;
					style.textContent = styles;
					document.head.appendChild(style);
				}
				let overlay = document.getElementById(overlayId);
				if (!overlay) {
					overlay = document.createElement("div");
					overlay.id = overlayId;
					overlay.innerHTML = `
						<div class="ks-header">
							<div class="ks-title">KeepSidian OAuth Helper</div>
							<button class="ks-toggle" type="button">Hide</button>
						</div>
						<div class="ks-body">
							<div class="ks-step"></div>
							<div class="ks-message"></div>
							<ol class="ks-steps"></ol>
							<div class="ks-status"></div>
						</div>
					`;
					document.body.appendChild(overlay);
					const overlayElement = overlay;
					const toggle = overlayElement.querySelector(".ks-toggle");
					if (toggle) {
						toggle.addEventListener("click", () => {
							overlayElement.classList.toggle("minimized");
							toggle.textContent = overlayElement.classList.contains("minimized")
								? "Show"
								: "Hide";
						});
					}
				}
				const overlayElement = overlay;
				if (!overlayElement) {
					return;
				}
				if (!payload) {
					return;
				}
				const stepEl = overlayElement.querySelector(".ks-step");
				const messageEl = overlayElement.querySelector(".ks-message");
				const stepsEl = overlayElement.querySelector(".ks-steps");
				const statusEl = overlayElement.querySelector(".ks-status");
				if (stepEl) {
					stepEl.textContent = payload.title || "";
				}
				if (messageEl) {
					messageEl.textContent = payload.message || "";
				}
				if (stepsEl) {
					while (stepsEl.firstChild) {
						stepsEl.removeChild(stepsEl.firstChild);
					}
					if (Array.isArray(payload.steps)) {
						for (const item of payload.steps) {
							const li = document.createElement("li");
							li.textContent = item;
							stepsEl.appendChild(li);
						}
					}
				}
				if (statusEl) {
					statusEl.textContent = payload.status || "";
				}
			},
			{
				overlayId: OVERLAY_ID,
				styles: overlayStyles,
				payload,
			}
		);
	} catch (error) {
		logSessionEvent("debug", "Failed to inject overlay", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
	}
};

const getInputValue = async (page: AutomationPage, selectors: string[]) => {
	for (const selector of selectors) {
		try {
			const value = await page.$eval(selector, (el) => {
				if ("value" in el && typeof (el as HTMLInputElement).value === "string") {
					return (el as HTMLInputElement).value;
				}
				return "";
			});
			if (value) {
				return value;
			}
		} catch {
			// ignore
		}
	}
	return "";
};

const clickIfEnabled = async (page: AutomationPage, selectors: string[]) => {
	for (const selector of selectors) {
		try {
			const clicked = await page.$eval(selector, (el) => {
				const aria = el.getAttribute?.("aria-disabled");
				const isDisabled =
					("disabled" in el && Boolean((el as HTMLButtonElement).disabled)) ||
					aria === "true";
				if (isDisabled) {
					return false;
				}
				(el as HTMLElement).click();
				return true;
			});
			if (clicked) {
				return true;
			}
		} catch {
			// ignore
		}
	}
	return false;
};

const detectScreen = async (page: AutomationPage, logSessionEvent: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void) => {
	try {
		return await page.evaluate(() => {
			const text = document.body?.innerText || "";
			const normalized = text.replace(/\s+/g, " ").trim();
			const lower = normalized.toLowerCase();
			const includes = (value: string) => lower.includes(value);
			const challengeOptions = Array.from(
				document.querySelectorAll("#challengePickerList li, #challengePickerList [role='button']")
			)
				.map((el) => el.textContent?.trim() || "")
				.filter((value) => value.length > 0);
			const hasEmailInput = Boolean(
				document.querySelector("input[type='email'], #identifierId")
			);
			const hasPasswordInput = Boolean(
				document.querySelector("input[type='password'][name='Passwd'], input[type='password']")
			);
			const hasAccountChooser = Boolean(
				document.querySelector("[data-identifier]") ||
					document.querySelector("div[data-email]") ||
					document.querySelector("#profileIdentifier")
			);
			const hasSmsInput = Boolean(
				document.querySelector("input[name='idvPin'], input[autocomplete='one-time-code']")
			);
			const hasTotpInput = Boolean(document.querySelector("input[name='totpPin']"));
			const hasSecurityKey = includes("security key");
			const hasPrompt = includes("check your phone") || includes("tap yes");
			const hasBackupCode = includes("backup code");
			const hasTryAnotherWay = includes("try another way");
			const hasCaptcha =
				includes("captcha") ||
				Boolean(document.querySelector("iframe[src*='recaptcha']"));
			const hasConsent =
				includes("allow") &&
				Boolean(
					document.querySelector("#submit_approve_access") ||
						document.querySelector("button[type='submit']") ||
						document.querySelector("button[jsname]")
				);
			const blocked =
				includes("not secure") ||
				includes("can't sign in") ||
				includes("couldn’t sign you in") ||
				includes("browser or app may not be secure");
			return {
				url: location.href,
				title: document.title,
				hasEmailInput,
				hasPasswordInput,
				hasAccountChooser,
				hasSmsInput,
				hasTotpInput,
				hasSecurityKey,
				hasPrompt,
				hasBackupCode,
				hasTryAnotherWay,
				hasConsent,
				hasCaptcha,
				blocked,
				challengeOptions,
			} satisfies ScreenState;
		});
	} catch (error) {
		logSessionEvent("debug", "Screen detection failed", {
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
};

const buildOverlayPayload = (screen: ScreenState | null, email: string): OverlayPayload => {
	if (!screen) {
		return {
			key: "loading",
			title: "Loading Google sign-in",
			message: "Waiting for the login page to load.",
			steps: ["If the page is blank, wait a moment and it should appear."],
			status: "",
		};
	}
	if (screen.blocked) {
		return {
			key: "blocked",
			title: "Google blocked this sign-in",
			message:
				"Google is blocking automated or embedded logins here. Try the system browser option or a different account.",
			steps: ["Close this window when ready.", "Try the Playwright system browser toggle."],
			status: screen.url,
		};
	}
	if (screen.hasAccountChooser) {
		return {
			key: "account",
			title: "Choose your account",
			message: "Pick the Google account you want to use.",
			steps: ["Select the account tile.", "We will continue automatically."],
			status: screen.url,
		};
	}
	if (screen.hasEmailInput) {
		return {
			key: "email",
			title: "Enter email",
			message: email ? `Enter the email for ${email}.` : "Enter the Google account email.",
			steps: ["Type your email.", "We will click Next once you are done."],
			status: screen.url,
		};
	}
	if (screen.hasPasswordInput) {
		return {
			key: "password",
			title: "Enter password",
			message: "Enter your password to continue.",
			steps: ["Type your password.", "We will click Next after you finish."],
			status: screen.url,
		};
	}
	if (screen.challengeOptions.length > 0) {
		return {
			key: "challenge-options",
			title: "Choose verification method",
			message: "Google needs extra verification. Pick one of the methods shown.",
			steps: screen.challengeOptions.slice(0, 4),
			status: screen.url,
		};
	}
	if (screen.hasSmsInput) {
		return {
			key: "sms",
			title: "Enter verification code",
			message: "Enter the code sent to your phone.",
			steps: ["Type the code.", "We will continue once it is accepted."],
			status: screen.url,
		};
	}
	if (screen.hasTotpInput) {
		return {
			key: "totp",
			title: "Enter authenticator code",
			message: "Open your authenticator app and enter the code.",
			steps: ["Type the current code.", "We will continue once it is accepted."],
			status: screen.url,
		};
	}
	if (screen.hasPrompt) {
		return {
			key: "prompt",
			title: "Approve sign-in",
			message: "Check your phone and approve the sign-in prompt.",
			steps: ["Tap Yes on your device.", "Return here when it completes."],
			status: screen.url,
		};
	}
	if (screen.hasSecurityKey) {
		return {
			key: "security-key",
			title: "Use your security key",
			message: "Touch your security key to continue.",
			steps: ["Insert your key.", "Touch or tap it when prompted."],
			status: screen.url,
		};
	}
	if (screen.hasBackupCode || screen.hasTryAnotherWay) {
		return {
			key: "backup",
			title: "Complete verification",
			message: "Use a backup code or choose another verification method.",
			steps: ["Select an option.", "Follow the on-screen prompts."],
			status: screen.url,
		};
	}
	if (screen.hasCaptcha) {
		return {
			key: "captcha",
			title: "Complete CAPTCHA",
			message: "Google needs a CAPTCHA. Complete the challenge to continue.",
			steps: ["Solve the CAPTCHA prompt.", "Return here once it finishes."],
			status: screen.url,
		};
	}
	if (screen.hasConsent) {
		return {
			key: "consent",
			title: "Review access",
			message: "Review the consent screen and continue.",
			steps: ["Click Allow or Continue.", "We will capture the cookie next."],
			status: screen.url,
		};
	}
	return {
		key: "generic",
		title: "Continue in the browser",
		message: "Follow the Google prompts until the login completes.",
		steps: ["Complete any remaining prompts.", "We will capture the cookie automatically."],
		status: screen.url,
	};
};

const extractOauthToken = (cookies: CookieSnapshot[]) => {
	const oauthCookie = cookies.find((cookie) => cookie.name === "oauth_token");
	return oauthCookie?.value;
};

const runPuppeteerFlow = async (
	email: string,
	timeoutMs: number,
	logSessionEvent: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void
): Promise<AutomationResult> => {
	const pcrModule = pcrImport?.default ?? pcrImport;
	const stats = await pcrModule();
	const puppeteer = stats.puppeteer as {
		launch: (options: Record<string, unknown>) => Promise<{
			newPage: () => Promise<
				AutomationPage & {
					setUserAgent: (ua: string) => Promise<void>;
					target: () => { createCDPSession: () => Promise<{ send: (method: string) => Promise<{ cookies?: CookieSnapshot[] }> }> };
				}
			>;
			close: () => Promise<void>;
		}>;
	};
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "keepsidian-oauth-"));
	const browser = await puppeteer.launch({
		executablePath: stats.executablePath,
		headless: false,
		userDataDir: tempDir,
		defaultViewport: null,
		args: [
			"--disable-blink-features=AutomationControlled",
			"--no-default-browser-check",
			"--no-first-run",
		],
	});

	let pageClosed = false;
	try {
		const page = await browser.newPage();
		await page.setUserAgent(DEFAULT_USER_AGENT);
		page.on("console", (message) => {
			const payload =
				message && typeof message === "object"
					? {
							type:
								typeof (message as { type?: () => string }).type === "function"
									? (message as { type: () => string }).type()
									: "log",
							text:
								typeof (message as { text?: () => string }).text === "function"
									? (message as { text: () => string }).text()
									: String(message),
						}
					: { type: "log", text: String(message) };
			logSessionEvent("debug", "Page console", payload);
		});
		page.on("pageerror", (error) => {
			logSessionEvent("debug", "Page error", {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		});
		page.on("requestfailed", (request) => {
			const req = request as { url?: () => string; failure?: () => { errorText?: string } | null };
			logSessionEvent("debug", "Request failed", {
				url: typeof req.url === "function" ? req.url() : "",
				errorText: req.failure?.()?.errorText ?? "",
			});
		});
		page.on("response", (response) => {
			const res = response as { url?: () => string; status?: () => number };
			const status = typeof res.status === "function" ? res.status() : 0;
			if (status >= 400) {
				logSessionEvent("debug", "Response error", {
					url: typeof res.url === "function" ? res.url() : "",
					status,
				});
			}
		});
		page.on("close", () => {
			pageClosed = true;
		});

		await page.goto(DEFAULT_OAUTH_URL, { waitUntil: "domcontentloaded" });
		await ensureOverlay(page, null, logSessionEvent);

		const client = await page.target().createCDPSession();
		await client.send("Network.enable");

		let overlayPayload: OverlayPayload | null = null;
		let lastStepKey = "";
		let clickedEmailNext = false;
		let clickedPasswordNext = false;
		const startedAt = Date.now();

		while (!pageClosed && Date.now() - startedAt < timeoutMs) {
			if (overlayPayload) {
				await ensureOverlay(page, overlayPayload, logSessionEvent);
			}
			const response = await client.send("Network.getAllCookies");
			const cookies = Array.isArray(response.cookies) ? response.cookies : [];
			const token = extractOauthToken(cookies);
			if (token) {
				overlayPayload = {
					key: "success",
					title: "OAuth cookie captured",
					message: "KeepSidian can now exchange your token.",
					steps: ["You can close this browser window."],
					status: "Success",
				};
				await ensureOverlay(page, overlayPayload, logSessionEvent);
				return {
					oauth_token: token,
					engine: "puppeteer",
					url: page.url(),
					timestamp: new Date().toISOString(),
				};
			}

			const screen = await detectScreen(page, logSessionEvent);
			const nextPayload = buildOverlayPayload(screen, email);
			if (nextPayload.key !== lastStepKey) {
				overlayPayload = nextPayload;
				await ensureOverlay(page, overlayPayload, logSessionEvent);
				lastStepKey = nextPayload.key;
				logSessionEvent("debug", "Detected screen", { step: lastStepKey, url: screen?.url });
			}

			if (screen?.hasEmailInput && !clickedEmailNext) {
				const value = await getInputValue(page, ["#identifierId", "input[type='email']"]);
				if (value) {
					const clicked = await clickIfEnabled(page, [
						"#identifierNext button",
						"#identifierNext",
					]);
					if (clicked) {
						clickedEmailNext = true;
						logSessionEvent("info", "Clicked Next after email entry");
					}
				}
			}
			if (screen?.hasPasswordInput && !clickedPasswordNext) {
				const value = await getInputValue(page, [
					"input[name='Passwd']",
					"input[type='password']",
				]);
				if (value) {
					const clicked = await clickIfEnabled(page, [
						"#passwordNext button",
						"#passwordNext",
					]);
					if (clicked) {
						clickedPasswordNext = true;
						logSessionEvent("info", "Clicked Next after password entry");
					}
				}
			}

			await delay(1000);
		}

		throw new Error("Timed out waiting for OAuth cookie.");
	} finally {
		try {
			await browser.close();
		} catch {
			// ignore
		}
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
};

const resolveChannels = () => {
	if (process.platform === "win32") {
		return ["msedge", "chrome"];
	}
	if (process.platform === "darwin") {
		return ["chrome", "msedge"];
	}
	return ["chrome", "chromium"];
};

const runPlaywrightFlow = async (
	email: string,
	timeoutMs: number,
	options: AutomationOptions,
	logSessionEvent: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void
): Promise<AutomationResult> => {
	const launchOptions = {
		headless: false,
		args: ["--disable-blink-features=AutomationControlled"],
	};
	let browser: Browser | undefined;

	if (options.useSystemBrowser) {
		for (const channel of resolveChannels()) {
			try {
				browser = await chromium.launch({ ...launchOptions, channel });
				logSessionEvent("info", "Using system browser channel", { channel });
				break;
			} catch (error) {
				logSessionEvent("debug", "Failed to launch channel", {
					channel,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	if (!browser) {
		browser = await chromium.launch(launchOptions);
	}

	let pageClosed = false;
	try {
		if (!browser) {
			throw new Error("Failed to launch Playwright browser.");
		}
		const context = (await browser.newContext({
			viewport: null,
			userAgent: DEFAULT_USER_AGENT,
		})) as BrowserContext;
		const page = (await context.newPage()) as Page;
		page.on("console", (message) => {
			const payload =
				message && typeof message === "object"
					? {
							type:
								typeof (message as { type?: () => string }).type === "function"
									? (message as { type: () => string }).type()
									: "log",
							text:
								typeof (message as { text?: () => string }).text === "function"
									? (message as { text: () => string }).text()
									: String(message),
						}
					: { type: "log", text: String(message) };
			logSessionEvent("debug", "Page console", payload);
		});
		page.on("pageerror", (error) => {
			logSessionEvent("debug", "Page error", {
				errorMessage: error instanceof Error ? error.message : String(error),
			});
		});
		page.on("requestfailed", (request) => {
			const req = request as { url?: () => string; failure?: () => { errorText?: string } | null };
			logSessionEvent("debug", "Request failed", {
				url: typeof req.url === "function" ? req.url() : "",
				errorText: req.failure?.()?.errorText ?? "",
			});
		});
		page.on("response", (response) => {
			const res = response as { url?: () => string; status?: () => number };
			const status = typeof res.status === "function" ? res.status() : 0;
			if (status >= 400) {
				logSessionEvent("debug", "Response error", {
					url: typeof res.url === "function" ? res.url() : "",
					status,
				});
			}
		});
		page.on("close", () => {
			pageClosed = true;
		});

		await page.goto(DEFAULT_OAUTH_URL, { waitUntil: "domcontentloaded" });
		await ensureOverlay(page, null, logSessionEvent);

		let overlayPayload: OverlayPayload | null = null;
		let lastStepKey = "";
		let clickedEmailNext = false;
		let clickedPasswordNext = false;
		const startedAt = Date.now();

		while (!pageClosed && Date.now() - startedAt < timeoutMs) {
			if (overlayPayload) {
				await ensureOverlay(page, overlayPayload, logSessionEvent);
			}
			const cookies = await context.cookies();
			const token = extractOauthToken(cookies);
			if (token) {
				overlayPayload = {
					key: "success",
					title: "OAuth cookie captured",
					message: "KeepSidian can now exchange your token.",
					steps: ["You can close this browser window."],
					status: "Success",
				};
				await ensureOverlay(page, overlayPayload, logSessionEvent);
				return {
					oauth_token: token,
					engine: "playwright",
					url: page.url(),
					timestamp: new Date().toISOString(),
				};
			}

			const screen = await detectScreen(page, logSessionEvent);
			const nextPayload = buildOverlayPayload(screen, email);
			if (nextPayload.key !== lastStepKey) {
				overlayPayload = nextPayload;
				await ensureOverlay(page, overlayPayload, logSessionEvent);
				lastStepKey = nextPayload.key;
				logSessionEvent("debug", "Detected screen", { step: lastStepKey, url: screen?.url });
			}

			if (screen?.hasEmailInput && !clickedEmailNext) {
				const value = await getInputValue(page, ["#identifierId", "input[type='email']"]);
				if (value) {
					const clicked = await clickIfEnabled(page, [
						"#identifierNext button",
						"#identifierNext",
					]);
					if (clicked) {
						clickedEmailNext = true;
						logSessionEvent("info", "Clicked Next after email entry");
					}
				}
			}
			if (screen?.hasPasswordInput && !clickedPasswordNext) {
				const value = await getInputValue(page, [
					"input[name='Passwd']",
					"input[type='password']",
				]);
				if (value) {
					const clicked = await clickIfEnabled(page, [
						"#passwordNext button",
						"#passwordNext",
					]);
					if (clicked) {
						clickedPasswordNext = true;
						logSessionEvent("info", "Clicked Next after password entry");
					}
				}
			}

			await delay(1000);
		}

		throw new Error("Timed out waiting for OAuth cookie.");
	} finally {
		try {
			if (browser) {
				await browser.close();
			}
		} catch {
			// ignore
		}
	}
};
