import { chromium } from "playwright";
import type { Browser } from "playwright";
import { DEFAULT_OAUTH_URL, DEFAULT_USER_AGENT } from "./constants";
import { delay, extractOauthToken, resolveChannels } from "./helpers";
import {
	attachPageDebugListeners,
	clickButtonByText,
	clickIfEnabled,
	ensureOverlay,
	getActiveInputValue,
	getInputValue,
	setInputValue,
} from "./pageActions";
import { buildOverlayPayload, detectScreen } from "./screen";
import type { AutomationLogEvent, AutomationOptions, AutomationPage, AutomationResult, OverlayPayload } from "./types";

export async function runPlaywrightFlow(
	email: string,
	timeoutMs: number,
	options: AutomationOptions,
	logSessionEvent: AutomationLogEvent
): Promise<AutomationResult> {
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
		const context = await browser.newContext({
			viewport: null,
			userAgent: DEFAULT_USER_AGENT,
		});
		const page = await context.newPage();
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
}
