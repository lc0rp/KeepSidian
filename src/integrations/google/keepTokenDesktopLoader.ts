import type KeepSidianPlugin from "main";
import type { WebviewTag } from "electron";
import type { KeepSidianSettingsTab } from "ui/settings/KeepSidianSettingsTab";

type InitRetrieveToken = (
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	retrieveTokenWebview: WebviewTag
) => Promise<void>;

interface KeepTokenDesktopModule {
	initRetrieveToken: InitRetrieveToken;
}

type RequireLike = (moduleId: string) => unknown;

const resolveRequire = (): RequireLike | null => {
	const globalScope = globalThis as unknown as {
		require?: RequireLike;
		window?: { require?: RequireLike };
	};
	if (typeof globalScope.require === "function") {
		return globalScope.require;
	}
	if (typeof globalScope.window?.require === "function") {
		return globalScope.window.require;
	}
	return null;
};

export async function loadKeepTokenDesktop(): Promise<KeepTokenDesktopModule> {
	const req = resolveRequire();
	if (!req) {
		throw new Error("Desktop module loader unavailable (require not found).");
	}
	let loaded: Partial<KeepTokenDesktopModule> | undefined;
	try {
		loaded = req("./keepTokenDesktop") as Partial<KeepTokenDesktopModule> | undefined;
	} catch {
		loaded = req("./keepTokenDesktop.js") as Partial<KeepTokenDesktopModule> | undefined;
	}
	if (!loaded || typeof loaded.initRetrieveToken !== "function") {
		throw new Error("Failed to load keepTokenDesktop module.");
	}
	return loaded as KeepTokenDesktopModule;
}
