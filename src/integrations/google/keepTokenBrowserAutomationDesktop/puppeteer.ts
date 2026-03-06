import fs from "fs";
import os from "os";
import path from "path";
import pcrImport from "puppeteer-chromium-resolver";
import { DEFAULT_OAUTH_URL, DEFAULT_USER_AGENT } from "./constants";
import { delay, extractOauthToken } from "./helpers";
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
import type { AutomationLogEvent, AutomationPage, AutomationResult, CookieSnapshot, OverlayPayload } from "./types";

export async function runPuppeteerFlow(
	email: string,
	timeoutMs: number,
	logSessionEvent: AutomationLogEvent
): Promise<AutomationResult> {
	const pcrModule = pcrImport?.default ?? pcrImport;
	const stats = await pcrModule();
	const puppeteer = stats.puppeteer as {
		launch: (options: Record<string, unknown>) => Promise<{
			newPage: () => Promise<
				AutomationPage & {
					setUserAgent: (ua: string) => Promise<void>;
					target: () => {
						createCDPSession: () => Promise<{
							send: (method: string) => Promise<{ cookies?: CookieSnapshot[] }>;
						}>;
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
				const nextPage = await target.page();
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
					value ||
					(emailInjected ? await getInputValue(loopPage, ["#identifierId", "input[type='email']"]) : "");
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
}
