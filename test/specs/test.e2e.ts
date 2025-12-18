import { browser, expect } from "@wdio/globals";

describe("KeepSidian", function () {
	before(async function () {
		// You can create test vaults and open them with reloadObsidian
		// Alternatively if all your tests use the same vault, you can
		// set the default vault in the wdio.conf.mts.
		await browser.reloadObsidian({ vault: "./test/vaults/simple" });
	});

	it("loads the plugin", async () => {
		const pluginLoaded = await browser.execute(() => {
			type ObsidianWindow = Window & {
				app?: {
					plugins?: { getPlugin?: (id: string) => unknown };
				};
			};

			const app = (window as ObsidianWindow).app;
			return Boolean(app?.plugins?.getPlugin?.("keepsidian"));
		});

		expect(pluginLoaded).toBe(true);
	});

	it("registers expected commands", async () => {
		const commandIds = await browser.execute(() => {
			type ObsidianWindow = Window & {
				app?: {
					commands?: {
						listCommands?: () => Array<{ id: string }>;
					};
				};
			};

			const app = (window as ObsidianWindow).app;
			const commands = app?.commands?.listCommands?.() ?? [];
			return commands.map((command) => command.id);
		});

		expect(commandIds).toContain("keepsidian:two-way-sync-google-keep");
		expect(commandIds).toContain("keepsidian:import-google-keep-notes");
		expect(commandIds).toContain("keepsidian:push-google-keep-notes");
		expect(commandIds).toContain("keepsidian:open-sync-log-file");
	});

	it("opens a vault note and the KeepSidian settings tab", async function () {
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getAbstractFileByPath("Inbox.md");
			if (!file) {
				throw new Error("Expected Inbox.md to exist in the test vault");
			}
			await app.workspace.getLeaf(false).openFile(file);
		});

		const editorView = browser.$(".markdown-source-view, .markdown-preview-view");
		await editorView.waitForExist({ timeout: 20000 });

		const settingsCommandId = await browser.execute(() => {
			type ObsidianWindow = Window & {
				app?: {
					commands?: {
						listCommands?: () => Array<{ id: string; name: string }>;
					};
				};
			};

			const commands = (window as ObsidianWindow).app?.commands?.listCommands?.() ?? [];
			const lower = (value: string) => value.toLowerCase();
			const match =
				commands.find((command) => command.id === "app:open-settings") ??
				commands.find((command) => lower(command.id).includes("open-settings")) ??
				commands.find((command) => lower(command.name).includes("settings"));
			return match?.id ?? null;
		});

		if (!settingsCommandId) {
			throw new Error("Could not find an Obsidian command to open settings");
		}

		await browser.executeObsidianCommand(settingsCommandId);

		await browser.waitUntil(
			async () => (await browser.$$(".setting-tab-container, .modal.mod-settings")).length > 0,
			{ timeout: 20000, interval: 200 }
		);

		const navItems = await browser.$$(".vertical-tab-nav-item");
		const keepSidianNav = await (async () => {
			for (const item of navItems) {
				if ((await item.getText()).includes("KeepSidian")) {
					return item;
				}
			}
			return null;
		})();

		if (!keepSidianNav) {
			throw new Error("Could not find KeepSidian in the settings navigation");
		}

		await keepSidianNav.click();

		const emailSetting = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Email"]'
		);
		await emailSetting.waitForExist({ timeout: 20000 });
	});
});
