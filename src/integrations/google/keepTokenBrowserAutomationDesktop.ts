import type KeepSidianPlugin from "main";
import { DEFAULT_TIMEOUT_MINUTES } from "./keepTokenBrowserAutomationDesktop/constants";
import { createAutomationLogger } from "./keepTokenBrowserAutomationDesktop/logging";
import { runPlaywrightFlow } from "./keepTokenBrowserAutomationDesktop/playwright";
import { runPuppeteerFlow } from "./keepTokenBrowserAutomationDesktop/puppeteer";
import type {
	AutomationEngine,
	AutomationOptions,
	AutomationResult,
} from "./keepTokenBrowserAutomationDesktop/types";

export async function runOauthBrowserAutomationDesktop(
	plugin: KeepSidianPlugin,
	engine: AutomationEngine,
	options: AutomationOptions = {}
): Promise<AutomationResult> {
	const debugEnabled = Boolean(options.debug);
	const timeoutMinutes = options.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
	const timeoutMs = timeoutMinutes * 60_000;
	const email = plugin.settings.email ?? "";
	const logSessionEvent = createAutomationLogger(debugEnabled);

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
