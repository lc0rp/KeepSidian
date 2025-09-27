import type KeepSidianPlugin from "@app/main";

export function registerRibbonIcon(plugin: KeepSidianPlugin) {
	plugin.addRibbonIcon(
		"folder-sync",
		"KeepSidian: Perform two-way sync",
		(_evt: MouseEvent) => {
			plugin.performTwoWaySync();
		}
	);
}

export function registerCommands(plugin: KeepSidianPlugin) {
	plugin.addCommand({
		id: "two-way-sync-google-keep",
		name: "Perform two-way sync",
		callback: async () => await plugin.performTwoWaySync(),
	});

	plugin.addCommand({
		id: "import-google-keep-notes",
		name: "Download notes from Google Keep",
		callback: async () => await plugin.importNotes(),
	});

	plugin.addCommand({
		id: "push-google-keep-notes",
		name: "Upload notes to Google Keep",
		callback: async () => await plugin.pushNotes(),
	});

	plugin.addCommand({
		id: "open-keepsidian-sync-log",
		name: "Open sync log file",
		callback: async () => await plugin.openLatestSyncLog(),
	});
}

export function registerRibbonAndCommands(plugin: KeepSidianPlugin) {
	registerRibbonIcon(plugin);
	registerCommands(plugin);
}
