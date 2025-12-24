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
	$eval: <T, Arg = void>(selector: string, pageFunction: (el: Element, arg: Arg) => T, arg?: Arg) => Promise<T>;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
	url: () => string;
	goto: (url: string, options?: { waitUntil?: "domcontentloaded" | "load" }) => Promise<unknown>;
	isClosed?: () => boolean;
	bringToFront?: () => Promise<void>;
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
	isChallengeUrl: boolean;
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
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const attachPageDebugListeners = (
	page: AutomationPage,
	logSessionEvent: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void
) => {
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
		const req = request as {
			url?: () => string;
			failure?: () => { errorText?: string } | null;
		};
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
};

export async function runOauthBrowserAutomationDesktop(
	plugin: KeepSidianPlugin,
	engine: AutomationEngine,
	options: AutomationOptions = {}
): Promise<AutomationResult> {
	const debugEnabled = Boolean(options.debug);
	const timeoutMinutes = options.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
	const timeoutMs = timeoutMinutes * 60_000;
	const email = plugin.settings.email ?? "";

	const logSessionEvent = (level: LogLevel, message: string, metadata: Record<string, unknown> = {}) => {
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
					style.appendChild(document.createTextNode(styles));
					document.head?.appendChild(style);
				}
				let overlay = document.getElementById(overlayId);
				if (!overlay) {
					overlay = document.createElement("div");
					overlay.id = overlayId;

					const header = document.createElement("div");
					header.className = "ks-header";

					const title = document.createElement("div");
					title.className = "ks-title";
					title.textContent = "KeepSidian token helper";

					const toggle = document.createElement("button");
					toggle.className = "ks-toggle";
					toggle.type = "button";
					toggle.textContent = "Hide";

					header.appendChild(title);
					header.appendChild(toggle);

					const body = document.createElement("div");
					body.className = "ks-body";

					const step = document.createElement("div");
					step.className = "ks-step";

					const message = document.createElement("div");
					message.className = "ks-message";

					const steps = document.createElement("ol");
					steps.className = "ks-steps";

					const status = document.createElement("div");
					status.className = "ks-status";

					body.appendChild(step);
					body.appendChild(message);
					body.appendChild(steps);
					body.appendChild(status);

					overlay.appendChild(header);
					overlay.appendChild(body);

					document.body?.appendChild(overlay);

					toggle.addEventListener("click", () => {
						overlay?.classList.toggle("minimized");
						toggle.textContent = overlay?.classList.contains("minimized") ? "Show" : "Hide";
					});
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
					const status = payload.status || "";
					statusEl.textContent = status;
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
			const value = await page.$eval(selector, (el: Element) => {
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

const getActiveInputValue = async (page: AutomationPage, selectors: string[]) => {
	try {
		return await page.evaluate((selectorList) => {
			const active = document.activeElement;
			if (!active || !(active instanceof HTMLInputElement)) {
				return { value: "", isFocused: false };
			}
			const isMatch = selectorList.some((selector) => active.matches(selector));
			return {
				value: isMatch ? active.value : "",
				isFocused: isMatch,
			};
		}, selectors);
	} catch {
		return { value: "", isFocused: false };
	}
};

const setInputValue = async (page: AutomationPage, selectors: string[], value: string) => {
	for (const selector of selectors) {
		try {
			const didSet = await page.$eval(
				selector,
				(el: Element, nextValue: string) => {
					if (!(el instanceof HTMLInputElement)) {
						return false;
					}
					el.focus();
					el.value = nextValue;
					el.dispatchEvent(new Event("input", { bubbles: true }));
					el.dispatchEvent(new Event("change", { bubbles: true }));
					return true;
				},
				value
			);
			if (didSet) {
				return true;
			}
		} catch {
			// ignore
		}
	}
	return false;
};

const clickIfEnabled = async (page: AutomationPage, selectors: string[]) => {
	for (const selector of selectors) {
		try {
			const clicked = await page.$eval(selector, (el: Element) => {
				const aria = el.getAttribute?.("aria-disabled");
				const isDisabled = ("disabled" in el && Boolean((el as HTMLButtonElement).disabled)) || aria === "true";
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

const clickButtonByText = async (page: AutomationPage, labels: string[]) => {
	const normalizedLabels = labels.map((label) => label.trim().toLowerCase());
	try {
		return await page.evaluate((targets) => {
			const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
			for (const button of buttons) {
				const text = button.textContent?.trim().toLowerCase() ?? "";
				if (!text) {
					continue;
				}
				if (targets.includes(text)) {
					(button as HTMLElement).click();
					return true;
				}
			}
			return false;
		}, normalizedLabels);
	} catch {
		return false;
	}
};

const detectScreen = async (
	page: AutomationPage,
	logSessionEvent: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void
) => {
	try {
		return await page.evaluate(() => {
			const text = document.body?.innerText || "";
			const normalized = text.replace(/\s+/g, " ").trim();
			const lower = normalized.toLowerCase();
			const includes = (value: string) => lower.includes(value);
			const isVisible = (element: Element | null) => {
				if (!element || !(element instanceof HTMLElement)) {
					return false;
				}
				const style = window.getComputedStyle(element);
				if (style.display === "none" || style.visibility === "hidden") {
					return false;
				}
				return element.getClientRects().length > 0;
			};
			const url = location.href;
			const lowerUrl = url.toLowerCase();
			const isPasswordUrl = lowerUrl.includes("/pwd");
			const isIdentifierUrl = lowerUrl.includes("/identifier");
			const isChallengeUrl = lowerUrl.includes("/challenge/");
			const isSpeedbumpUrl = lowerUrl.includes("/speedbump");
			const challengeOptions = Array.from(
				document.querySelectorAll("#challengePickerList li, #challengePickerList [role='button']")
			)
				.map((el) => el.textContent?.trim() || "")
				.filter((value) => value.length > 0);
			const emailInput = document.querySelector("input[type='email'], #identifierId");
			const passwordInput = document.querySelector(
				"input[type='password'][name='Passwd'], input[type='password']"
			);
			const hasPasswordInput = isPasswordUrl || isVisible(passwordInput);
			const hasEmailInput = !hasPasswordInput && (isIdentifierUrl || isVisible(emailInput));
			const hasSmsInput = Boolean(
				document.querySelector("input[name='idvPin'], input[autocomplete='one-time-code']")
			);
			const hasTotpInput = Boolean(document.querySelector("input[name='totpPin']"));
			const hasSecurityKey = includes("security key");
			const hasPromptText =
				includes("check your phone") ||
				includes("tap yes") ||
				includes("google sent a notification") ||
				includes("approve sign-in");
			const hasTryAnotherWay = includes("try another way");
			const hasResend = includes("resend");
			const hasPrompt =
				hasPromptText ||
				(isChallengeUrl && (hasTryAnotherWay || hasResend) && !hasSmsInput && !hasTotpInput && !hasSecurityKey);
			const hasBackupCode = includes("backup code");
			const hasChooseAccountText = includes("choose an account") || includes("choose your account");
			const consentLabels = ["i agree", "agree", "allow", "continue"];
			const hasConsentButton = Array.from(
				document.querySelectorAll("button, [role='button'], #submit_approve_access")
			).some((el) => {
				const text = (el.textContent || "").trim().toLowerCase();
				return text && consentLabels.includes(text);
			});
			const hasConsentText =
				includes("terms of service") || includes("privacy policy") || includes("you agree");
			const hasAccountChooser =
				(hasChooseAccountText ||
					Boolean(
						document.querySelector("[data-identifier]") ||
							document.querySelector("div[data-email]") ||
							document.querySelector("#profileIdentifier")
					)) &&
				!hasEmailInput &&
				!hasPasswordInput &&
				!hasPrompt &&
				!hasTryAnotherWay &&
				!hasSmsInput &&
				!hasTotpInput &&
				!hasSecurityKey &&
				!isChallengeUrl;
			const hasCaptcha = includes("captcha") || Boolean(document.querySelector("iframe[src*='recaptcha']"));
			const hasConsent =
				hasConsentButton &&
				(hasConsentText || includes("allow") || isSpeedbumpUrl || Boolean(document.querySelector("#submit_approve_access")));
			const blocked =
				includes("not secure") ||
				includes("can't sign in") ||
				includes("couldn’t sign you in") ||
				includes("browser or app may not be secure");
			return {
				url: location.href,
				title: document.title,
				isChallengeUrl,
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
	const withStep = (step: number, title: string) => `Step ${step}: ${title}`;
	if (!screen) {
		return {
			key: "loading",
			title: withStep(1, "Loading Google sign-in"),
			message: "Waiting for the login page to load.",
			steps: ["If the page is blank, wait a moment and it should appear."],
			status: "",
		};
	}
	if (screen.blocked) {
		return {
			key: "blocked",
			title: withStep(1, "Google blocked this sign-in"),
			message:
				"Google is blocking automated or embedded logins here. Try the system browser option or a different account.",
			steps: ["Close this window when ready.", "Try the Playwright system browser toggle."],
			status: screen.url,
		};
	}
	if (screen.hasAccountChooser) {
		return {
			key: "account",
			title: withStep(1, "Choose your account"),
			message: "Pick the Google account you want to use.",
			steps: ["Select the account tile.", "We will continue automatically."],
			status: screen.url,
		};
	}
	if (screen.hasEmailInput) {
		return {
			key: "email",
			title: withStep(1, "Enter email"),
			message: email ? `Enter the email for ${email}.` : "Enter the Google account email.",
			steps: ["Type your email.", "We will click Next once you are done."],
			status: screen.url,
		};
	}
	if (screen.hasPasswordInput) {
		return {
			key: "password",
			title: withStep(2, "Enter password"),
			message: "Enter your password to continue.",
			steps: ["Type your password.", "We will click Next after you finish."],
			status: screen.url,
		};
	}
	if (screen.challengeOptions.length > 0) {
		return {
			key: "challenge-options",
			title: withStep(3, "Choose verification method"),
			message: "Google needs extra verification. Pick one of the methods shown.",
			steps: screen.challengeOptions.slice(0, 4),
			status: screen.url,
		};
	}
	if (screen.hasSmsInput) {
		return {
			key: "sms",
			title: withStep(3, "Enter verification code"),
			message: "Enter the code sent to your phone.",
			steps: ["Type the code.", "We will continue once it is accepted."],
			status: screen.url,
		};
	}
	if (screen.hasTotpInput) {
		return {
			key: "totp",
			title: withStep(3, "Enter authenticator code"),
			message: "Open your authenticator app and enter the code.",
			steps: ["Type the current code.", "We will continue once it is accepted."],
			status: screen.url,
		};
	}
	if (screen.hasPrompt) {
		return {
			key: "prompt",
			title: withStep(3, "Approve sign-in"),
			message: "Check your phone and approve the sign-in prompt.",
			steps: ["Tap Yes on your device.", "Return here when it completes."],
			status: screen.url,
		};
	}
	if (screen.hasSecurityKey) {
		return {
			key: "security-key",
			title: withStep(3, "Use your security key"),
			message: "Touch your security key to continue.",
			steps: ["Insert your key.", "Touch or tap it when prompted."],
			status: screen.url,
		};
	}
	if (screen.hasBackupCode || screen.hasTryAnotherWay) {
		return {
			key: "backup",
			title: withStep(3, "Complete verification"),
			message: "Use a backup code or choose another verification method.",
			steps: ["Select an option.", "Follow the on-screen prompts."],
			status: screen.url,
		};
	}
	if (screen.hasCaptcha) {
		return {
			key: "captcha",
			title: withStep(3, "Complete CAPTCHA"),
			message: "Google needs a CAPTCHA. Complete the challenge to continue.",
			steps: ["Solve the CAPTCHA prompt.", "Return here once it finishes."],
			status: screen.url,
		};
	}
	if (
		screen.isChallengeUrl &&
		!screen.hasSmsInput &&
		!screen.hasTotpInput &&
		!screen.hasPrompt &&
		!screen.hasSecurityKey &&
		!screen.hasBackupCode &&
		!screen.hasTryAnotherWay &&
		!screen.hasCaptcha &&
		screen.challengeOptions.length === 0
	) {
		return {
			key: "challenge-generic",
			title: withStep(3, "Complete verification"),
			message: "Follow the on-screen verification steps to continue.",
			steps: ["Complete the verification prompt.", "Return here when it finishes."],
			status: screen.url,
		};
	}
	if (screen.hasConsent) {
		return {
			key: "consent",
			title: withStep(4, "Review access"),
			message: "Review the consent screen and continue.",
			steps: ["Click I agree / Allow / Continue.", "We will capture the cookie next."],
			status: screen.url,
		};
	}
	return {
		key: "generic",
		title: withStep(2, "Continue in the browser"),
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
					target: () => {
						createCDPSession: () => Promise<{ send: (method: string) => Promise<{ cookies?: CookieSnapshot[] }> }>;
					};
				}
			>;
			on: (
				event: "targetcreated",
				listener: (target: { type: () => string; page: () => Promise<AutomationPage | null> }) => void
			) => void;
			close: () => Promise<void>;
		}>;
	};
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "keepsidian-oauth-"));
	const browser = await puppeteer.launch({
		executablePath: stats.executablePath,
		headless: false,
		userDataDir: tempDir,
		defaultViewport: null,
		args: ["--disable-blink-features=AutomationControlled", "--no-default-browser-check", "--no-first-run"],
	});

	let pageClosed = false;
	try {
		const page = await browser.newPage();
		let activePage: AutomationPage = page;
		attachPageDebugListeners(page, logSessionEvent);
		page.on("close", () => {
			pageClosed = true;
		});
		try {
			await page.setUserAgent(DEFAULT_USER_AGENT);
		} catch {
			// ignore
		}
		const setActivePage = async (nextPage: AutomationPage | null) => {
			if (!nextPage || nextPage === activePage) {
				return;
			}
			activePage = nextPage;
			attachPageDebugListeners(activePage, logSessionEvent);
			try {
				await activePage.bringToFront?.();
			} catch {
				// ignore
			}
		};
		browser.on("targetcreated", async (target: { type: () => string; page: () => Promise<AutomationPage | null> }) => {
			try {
				if (target.type() !== "page") {
					return;
				}
				const nextPage = (await target.page()) as AutomationPage | null;
				if (nextPage) {
					await setActivePage(nextPage);
				}
			} catch (error) {
				logSessionEvent("debug", "Failed to attach popup page", {
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		});

		let overlayPayload: OverlayPayload | null = buildOverlayPayload(null, email);
		let lastStepKey = overlayPayload.key;
		let clickedEmailNext = false;
		let clickedPasswordNext = false;
		let lastPasswordValue = "";
		let lastPasswordChangeAt = 0;
		let clickedConsent = false;
		let emailInjected = false;
		await page.goto(DEFAULT_OAUTH_URL, { waitUntil: "domcontentloaded" });
		if (overlayPayload) {
			await ensureOverlay(page, overlayPayload, logSessionEvent);
		}

		const client = await (
			page as unknown as {
				target: () => {
					createCDPSession: () => Promise<{ send: (method: string) => Promise<{ cookies?: CookieSnapshot[] }> }>;
				};
			}
		)
			.target()
			.createCDPSession();
		await client.send("Network.enable");

		const startedAt = Date.now();

		while (!pageClosed && Date.now() - startedAt < timeoutMs) {
			const loopPage = activePage;
			if (loopPage?.isClosed?.()) {
				activePage = page;
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
				await ensureOverlay(loopPage, overlayPayload, logSessionEvent);
				return {
					oauth_token: token,
					engine: "puppeteer",
					url: loopPage.url(),
					timestamp: new Date().toISOString(),
				};
			}

			const screen = await detectScreen(loopPage, logSessionEvent);
			const nextPayload = buildOverlayPayload(screen, email);
			const stepChanged = nextPayload.key !== lastStepKey;
			overlayPayload = nextPayload;
			if (stepChanged) {
				lastStepKey = nextPayload.key;
				logSessionEvent("debug", "Detected screen", { step: lastStepKey, url: screen?.url });
			}
			await ensureOverlay(loopPage, overlayPayload, logSessionEvent);

			if (screen?.hasEmailInput && !clickedEmailNext) {
				const value = await getInputValue(loopPage, ["#identifierId", "input[type='email']"]);
				if (!emailInjected && !value && email) {
					const didFill = await setInputValue(loopPage, ["#identifierId", "input[type='email']"], email);
					if (didFill) {
						emailInjected = true;
						logSessionEvent("info", "Auto-filled email field");
					}
				}
				const valueAfter =
					value || (emailInjected ? await getInputValue(loopPage, ["#identifierId", "input[type='email']"]) : "");
				if (valueAfter) {
					const clicked = await clickIfEnabled(loopPage, ["#identifierNext button", "#identifierNext"]);
					if (clicked) {
						clickedEmailNext = true;
						logSessionEvent("info", "Clicked Next after email entry");
					}
				}
			}
			if (screen?.hasPasswordInput && !clickedPasswordNext) {
				const value = await getInputValue(loopPage, ["input[name='Passwd']", "input[type='password']"]);
				const activePassword = await getActiveInputValue(loopPage, [
					"input[name='Passwd']",
					"input[type='password']",
				]);
				const now = Date.now();
				const currentValue = activePassword.value || value;
				if (currentValue !== lastPasswordValue) {
					lastPasswordValue = currentValue;
					lastPasswordChangeAt = now;
				}
				const isBlurred = !activePassword.isFocused;
				const isIdle = currentValue.length > 0 && now - lastPasswordChangeAt >= 1500;
				if (value) {
					if (isBlurred || isIdle) {
						const clicked = await clickIfEnabled(loopPage, ["#passwordNext button", "#passwordNext"]);
						if (clicked) {
							clickedPasswordNext = true;
							logSessionEvent("info", "Clicked Next after password entry");
						}
					}
				}
			}
			if (screen?.hasConsent && !clickedConsent) {
				const clicked =
					(await clickButtonByText(loopPage, ["I agree", "Agree", "Allow", "Continue"])) ||
					(await clickIfEnabled(loopPage, ["#submit_approve_access"]));
				if (clicked) {
					clickedConsent = true;
					logSessionEvent("info", "Clicked consent button");
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
		let activePage: AutomationPage = page;
		const attachedPages = new Set<AutomationPage>();
		let overlayPayload: OverlayPayload | null = buildOverlayPayload(null, email);

		function registerPage(targetPage: AutomationPage) {
			if (attachedPages.has(targetPage)) {
				return;
			}
			attachedPages.add(targetPage);
			attachPageDebugListeners(targetPage, logSessionEvent);
			targetPage.on("close", () => {
				handlePageClose(targetPage);
			});
		}

		async function setActivePage(nextPage: AutomationPage | null) {
			if (!nextPage || nextPage === activePage) {
				return;
			}
			activePage = nextPage;
			pageClosed = false;
			registerPage(activePage);
			try {
				await activePage.bringToFront?.();
			} catch {
				// ignore
			}
			if (overlayPayload) {
				await ensureOverlay(activePage, overlayPayload, logSessionEvent);
			}
		}

		function handlePageClose(closedPage: AutomationPage) {
			if (closedPage !== activePage) {
				return;
			}
			const remaining = context.pages().filter((pageEntry) => !pageEntry.isClosed());
			if (remaining.length > 0) {
				void setActivePage(remaining[remaining.length - 1] as AutomationPage);
			} else {
				pageClosed = true;
			}
		}

		registerPage(page);
		context.on("page", (newPage) => {
			const targetPage = newPage as AutomationPage;
			registerPage(targetPage);
			void setActivePage(targetPage);
		});
		page.on("popup", (newPage) => {
			const targetPage = newPage as AutomationPage;
			registerPage(targetPage);
			void setActivePage(targetPage);
		});

		await page.goto(DEFAULT_OAUTH_URL, { waitUntil: "domcontentloaded" });
		if (overlayPayload) {
			await ensureOverlay(activePage, overlayPayload, logSessionEvent);
		}

		let lastStepKey = overlayPayload ? overlayPayload.key : "";
		let clickedEmailNext = false;
		let clickedPasswordNext = false;
		let lastPasswordValue = "";
		let lastPasswordChangeAt = 0;
		let clickedConsent = false;
		let emailInjected = false;
		const startedAt = Date.now();

		while (!pageClosed && Date.now() - startedAt < timeoutMs) {
			const loopPage = activePage;
			if (loopPage?.isClosed?.()) {
				handlePageClose(loopPage);
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
				await ensureOverlay(loopPage, overlayPayload, logSessionEvent);
				return {
					oauth_token: token,
					engine: "playwright",
					url: loopPage.url(),
					timestamp: new Date().toISOString(),
				};
			}

			const screen = await detectScreen(loopPage, logSessionEvent);
			const nextPayload = buildOverlayPayload(screen, email);
			const stepChanged = nextPayload.key !== lastStepKey;
			overlayPayload = nextPayload;
			if (stepChanged) {
				lastStepKey = nextPayload.key;
				logSessionEvent("debug", "Detected screen", { step: lastStepKey, url: screen?.url });
			}
			await ensureOverlay(loopPage, overlayPayload, logSessionEvent);

			if (screen?.hasEmailInput && !clickedEmailNext) {
				const value = await getInputValue(loopPage, ["#identifierId", "input[type='email']"]);
				let didFill = false;
				if (!emailInjected && !value && email) {
					didFill = await setInputValue(loopPage, ["#identifierId", "input[type='email']"], email);
					if (didFill) {
						emailInjected = true;
						logSessionEvent("info", "Auto-filled email field");
					}
				}
				const valueAfter =
					value ||
					(didFill
						? email
						: emailInjected
							? await getInputValue(loopPage, ["#identifierId", "input[type='email']"])
							: "");
				if (valueAfter) {
					const clicked = await clickIfEnabled(loopPage, ["#identifierNext button", "#identifierNext"]);
					if (clicked) {
						clickedEmailNext = true;
						logSessionEvent("info", "Clicked Next after email entry");
					}
				}
			}
			if (screen?.hasPasswordInput && !clickedPasswordNext) {
				const value = await getInputValue(loopPage, ["input[name='Passwd']", "input[type='password']"]);
				const activePassword = await getActiveInputValue(loopPage, [
					"input[name='Passwd']",
					"input[type='password']",
				]);
				const now = Date.now();
				const currentValue = activePassword.value || value;
				if (currentValue !== lastPasswordValue) {
					lastPasswordValue = currentValue;
					lastPasswordChangeAt = now;
				}
				const isBlurred = !activePassword.isFocused;
				const isIdle = currentValue.length > 0 && now - lastPasswordChangeAt >= 1500;
				if (value) {
					if (isBlurred || isIdle) {
						const clicked = await clickIfEnabled(loopPage, ["#passwordNext button", "#passwordNext"]);
						if (clicked) {
							clickedPasswordNext = true;
							logSessionEvent("info", "Clicked Next after password entry");
						}
					}
				}
			}
			if (screen?.hasConsent && !clickedConsent) {
				const clicked =
					(await clickButtonByText(loopPage, ["I agree", "Agree", "Allow", "Continue"])) ||
					(await clickIfEnabled(loopPage, ["#submit_approve_access"]));
				if (clicked) {
					clickedConsent = true;
					logSessionEvent("info", "Clicked consent button");
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
