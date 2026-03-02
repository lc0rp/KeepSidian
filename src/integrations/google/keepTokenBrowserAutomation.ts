import type KeepSidianPlugin from "main";

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

interface AutomationModule {
	runOauthBrowserAutomationDesktop: (
		plugin: KeepSidianPlugin,
		engine: AutomationEngine,
		options?: AutomationOptions
	) => Promise<AutomationResult>;
}

let desktopAutomationModulePromise: Promise<AutomationModule> | null = null;

const loadDesktopAutomationModule = async (): Promise<AutomationModule> => {
	if (!desktopAutomationModulePromise) {
		desktopAutomationModulePromise = import("@integrations/google/keepTokenBrowserAutomationDesktop")
			.then((loaded) => ({
				runOauthBrowserAutomationDesktop: loaded.runOauthBrowserAutomationDesktop,
			}))
			.catch((error) => {
				desktopAutomationModulePromise = null;
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to initialize browser automation module. ${message}`);
			});
	}
	const modulePromise = desktopAutomationModulePromise;
	if (!modulePromise) {
		throw new Error("Failed to initialize browser automation module.");
	}
	return await modulePromise;
};

export async function runOauthBrowserAutomation(
	plugin: KeepSidianPlugin,
	engine: AutomationEngine,
	options: AutomationOptions = {}
): Promise<AutomationResult> {
	const loaded = await loadDesktopAutomationModule();
	return await loaded.runOauthBrowserAutomationDesktop(plugin, engine, options);
}
