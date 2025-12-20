import { browser, expect } from "@wdio/globals";

describe("KeepSidian", function () {
	const openKeepSidianSettingsTab = async (): Promise<void> => {
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
	};

	const isAndroid = (): boolean => {
		const platform = (browser.capabilities as { platformName?: string }).platformName;
		return typeof platform === "string" && platform.toLowerCase() === "android";
	};

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
		await openKeepSidianSettingsTab();
	});

	it("shows retrieval wizard step one after clicking", async function () {
		await openKeepSidianSettingsTab();

		const emailInput = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Email"]/ancestor::*[contains(@class,"setting-item")]//input'
		);
		await emailInput.waitForExist({ timeout: 20000 });
		await emailInput.setValue("test@example.com");

		const retrievalButton = browser.$('//button[normalize-space(.)="Retrieval wizard"]');
		await retrievalButton.waitForExist({ timeout: 20000 });
		await retrievalButton.click();

		const guideTitle = browser.$(".keepsidian-retrieve-token-guide__title");
		await guideTitle.waitForExist({ timeout: 20000 });
		await browser.waitUntil(
			async () => (await guideTitle.getText()).includes("Step 1 of 3"),
			{ timeout: 20000, interval: 200 }
		);

		const webviewElement = browser.$(".keepsidian-retrieve-token-webview webview");
		await webviewElement.waitForExist({ timeout: 20000 });
		await browser.waitUntil(
			async () => {
				const src = await browser.execute((el) => {
					if (!(el instanceof HTMLElement)) {
						return "";
					}
					const attr = el.getAttribute("src");
					const prop = (el as unknown as { src?: string }).src;
					return attr || prop || "";
				}, webviewElement);
				return src.includes("accounts.google.com/EmbeddedSetup");
			},
			{ timeout: 20000, interval: 200 }
		);
	});

	it("hides retrieval wizard on mobile", async function () {
		if (!isAndroid()) {
			this.skip();
			return;
		}

		await openKeepSidianSettingsTab();

		const retrievalButton = browser.$('//button[normalize-space(.)="Retrieval wizard"]');
		expect(await retrievalButton.isExisting()).toBe(false);

		const mobileDescription = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Retrieve your sync token"]/ancestor::*[contains(@class,"setting-item")]//*[contains(@class,"setting-item-description")]'
		);
		await mobileDescription.waitForExist({ timeout: 20000 });
		expect(await mobileDescription.getText()).toContain("Mobile:");
	});
});
