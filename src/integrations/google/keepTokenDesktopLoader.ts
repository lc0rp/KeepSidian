import type KeepSidianPlugin from "main";
import type { WebviewTag } from "electron";
import type { KeepSidianSettingsTab } from "ui/settings/KeepSidianSettingsTab";

type InitRetrieveToken = (
	settingsTab: KeepSidianSettingsTab,
	plugin: KeepSidianPlugin,
	retrieveTokenWebview: WebviewTag,
	onOauthToken?: (token: string) => Promise<void>
) => Promise<void>;

interface KeepTokenDesktopModule {
	initRetrieveToken: InitRetrieveToken;
}

type RequireLike = (moduleId: string) => unknown;
type VaultAdapterWithBasePath = {
	getBasePath?: () => string;
	getFullPath?: (path: string) => string;
	basePath?: string;
};

type PathModule = {
	join: (...segments: string[]) => string;
	isAbsolute: (value: string) => boolean;
};

declare const require: RequireLike | undefined;
declare const module:
	| {
			require?: RequireLike;
	  }
	| undefined;

const resolveRequire = (): RequireLike | null => {
	const isTest =
		typeof process !== "undefined" &&
		(process.env?.NODE_ENV === "test" || !!process.env?.JEST_WORKER_ID);
	const candidates: RequireLike[] = [];
	const moduleRequire =
		typeof module !== "undefined" && typeof module?.require === "function"
			? module.require.bind(module)
			: null;
	if (moduleRequire) {
		candidates.push(moduleRequire);
	}
	if (typeof require === "function") {
		candidates.push(require);
	}
	const globalScope = globalThis as unknown as {
		require?: RequireLike;
		window?: { require?: RequireLike };
	};
	const globalRequire = typeof globalScope.require === "function" ? globalScope.require : null;
	const windowRequire =
		typeof globalScope.window?.require === "function"
			? globalScope.window.require
			: null;

	if (isTest && globalRequire) {
		return globalRequire;
	}

	if (windowRequire) {
		candidates.push(windowRequire);
	}
	if (globalRequire) {
		candidates.push(globalRequire);
	}

	return candidates.length > 0 ? candidates[0] : null;
};

const resolvePluginDir = (
	plugin: KeepSidianPlugin | undefined,
	pathModule: PathModule
): string | null => {
	if (!plugin) {
		return null;
	}
	const appWithPlugins = plugin.app as
		| {
				plugins?: { getPlugin?: (id: string) => { manifest?: { dir?: string } } };
		  }
		| undefined;
	const manifestDir =
		(plugin.manifest as { dir?: string } | undefined)?.dir ??
		appWithPlugins?.plugins?.getPlugin?.(plugin.manifest?.id ?? "")?.manifest?.dir;
	const adapter = plugin.app?.vault?.adapter as VaultAdapterWithBasePath | undefined;
	const configDir = plugin.app?.vault?.configDir;
	const pluginId = plugin.manifest?.id ?? "keepsidian";
	const resolveRelative = (value: string): string | null => {
		if (pathModule.isAbsolute(value)) {
			return value;
		}
		if (typeof adapter?.getFullPath === "function") {
			return adapter.getFullPath(value);
		}
		const basePath = adapter?.getBasePath?.() ?? adapter?.basePath;
		if (!basePath) {
			return value;
		}
		return pathModule.join(basePath, value);
	};

	if (typeof manifestDir === "string" && manifestDir.length > 0) {
		return resolveRelative(manifestDir);
	}
	if (!configDir) {
		return null;
	}
	if (typeof adapter?.getFullPath === "function") {
		return adapter.getFullPath(`${configDir}/plugins/${pluginId}`);
	}
	const basePath = adapter?.getBasePath?.() ?? adapter?.basePath;
	if (!basePath) {
		return null;
	}
	return pathModule.join(basePath, configDir, "plugins", pluginId);
};

export async function loadKeepTokenDesktop(
	plugin?: KeepSidianPlugin
): Promise<KeepTokenDesktopModule> {
	const req = resolveRequire();
	if (!req) {
		throw new Error("Desktop module loader unavailable (require not found).");
	}
	const pathModule = req("path") as PathModule;
	const candidates: string[] = [];
	const pluginDir = resolvePluginDir(plugin, pathModule);
	if (pluginDir) {
		const base = pathModule.join(pluginDir, "keepTokenDesktop");
		candidates.push(base, `${base}.js`);
	}
	if (typeof __dirname === "string" && __dirname.length > 0) {
		const base = pathModule.join(__dirname, "keepTokenDesktop");
		candidates.push(base, `${base}.js`);
	}
	candidates.push("./keepTokenDesktop", "./keepTokenDesktop.js");

	let loaded: Partial<KeepTokenDesktopModule> | undefined;
	let lastError: unknown;
	const failures: string[] = [];
	for (const candidate of candidates) {
		try {
			loaded = req(candidate) as Partial<KeepTokenDesktopModule> | undefined;
			if (loaded) {
				break;
			}
		} catch (error) {
			lastError = error;
			const message = error instanceof Error ? error.message : String(error);
			failures.push(`${candidate}: ${message}`);
		}
	}
	if (!loaded || typeof loaded.initRetrieveToken !== "function") {
		const errorMessage =
			lastError instanceof Error ? lastError.message : String(lastError ?? "");
		throw new Error(
			`Failed to load keepTokenDesktop module.${
				errorMessage ? ` ${errorMessage}` : ""
			}${failures.length ? ` Tried: ${failures.join(" | ")}` : ""}`
		);
	}
	return loaded as KeepTokenDesktopModule;
}
