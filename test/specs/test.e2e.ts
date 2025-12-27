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

	const stubTokenExchange = async (keepToken: string): Promise<void> => {
		await browser.execute((token) => {
			const obsidianModule = (window as Window & { require?: (id: string) => unknown }).require?.("obsidian") as
				| { requestUrl?: (options: { url?: string }) => Promise<unknown> }
				| undefined;
			if (!obsidianModule) {
				throw new Error("Obsidian module not available in test context");
			}
			const original = obsidianModule.requestUrl;
			(window as Window & { __keepsidianOriginalRequestUrl?: unknown }).__keepsidianOriginalRequestUrl = original;
			obsidianModule.requestUrl = async (options: { url?: string }) => {
				const url = typeof options?.url === "string" ? options.url : "";
				if (url.includes("/register")) {
					return { status: 200, json: { keep_token: token } };
				}
				if (typeof original === "function") {
					return original(options);
				}
				return { status: 200, json: {} };
			};
		}, keepToken);
	};

	const restoreTokenExchange = async (): Promise<void> => {
		await browser.execute(() => {
			const obsidianModule = (window as Window & { require?: (id: string) => unknown }).require?.("obsidian") as
				| { requestUrl?: (options: { url?: string }) => Promise<unknown> }
				| undefined;
			const original = (window as Window & { __keepsidianOriginalRequestUrl?: unknown })
				.__keepsidianOriginalRequestUrl as ((options: { url?: string }) => Promise<unknown>) | undefined;
			if (obsidianModule && typeof original === "function") {
				obsidianModule.requestUrl = original;
			}
		});
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

	it("shows retrieval wizard buttons on desktop", async function () {
		if (isAndroid()) {
			this.skip();
			return;
		}

		await openKeepSidianSettingsTab();

		const emailInput = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Email"]/ancestor::*[contains(@class,"setting-item")]//input'
		);
		await emailInput.waitForExist({ timeout: 20000 });
		await emailInput.setValue("test@example.com");

		const playwrightButton = browser.$('//button[normalize-space(.)="Launch wizard option 1"]');
		const puppeteerButton = browser.$('//button[normalize-space(.)="Launch wizard option 2"]');
		await playwrightButton.waitForExist({ timeout: 20000 });
		await puppeteerButton.waitForExist({ timeout: 20000 });
	});

	it("exchanges oauth2_4 token on change (desktop)", async function () {
		if (isAndroid()) {
			this.skip();
			return;
		}

		await openKeepSidianSettingsTab();
		await stubTokenExchange("e2e-keep-token");

		const tokenInput = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Sync token"]/ancestor::*[contains(@class,"setting-item")]//input'
		);
		await tokenInput.waitForExist({ timeout: 20000 });
		await tokenInput.setValue("oauth2_4/e2e-token");

		await browser.waitUntil(
			async () => {
				const token = await browser.executeObsidian(({ app }) => {
					const plugin = app.plugins.getPlugin("keepsidian") as
						| { settings?: { token?: string } }
						| undefined;
					return plugin?.settings?.token ?? "";
				});
				return token === "e2e-keep-token";
			},
			{ timeout: 20000, interval: 200 }
		);

		await restoreTokenExchange();
	});

	it("hides retrieval wizard on mobile", async function () {
		if (!isAndroid()) {
			this.skip();
			return;
		}

		await openKeepSidianSettingsTab();

		const playwrightButton = browser.$('//button[normalize-space(.)="Launch wizard option 1"]');
		const puppeteerButton = browser.$('//button[normalize-space(.)="Launch wizard option 2"]');
		expect(await playwrightButton.isExisting()).toBe(false);
		expect(await puppeteerButton.isExisting()).toBe(false);

		const mobileDescription = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Retrieve your sync token"]/ancestor::*[contains(@class,"setting-item")]//*[contains(@class,"setting-item-description")]'
		);
		await mobileDescription.waitForExist({ timeout: 20000 });
		expect(await mobileDescription.getText()).toContain("Mobile:");
	});

	it("exchanges oauth2_4 token on change (mobile)", async function () {
		if (!isAndroid()) {
			this.skip();
			return;
		}

		await openKeepSidianSettingsTab();
		await stubTokenExchange("e2e-keep-token-mobile");

		const tokenInput = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Sync token"]/ancestor::*[contains(@class,"setting-item")]//input'
		);
		await tokenInput.waitForExist({ timeout: 20000 });
		await tokenInput.setValue("oauth2_4/e2e-token-mobile");

		await browser.waitUntil(
			async () => {
				const token = await browser.executeObsidian(({ app }) => {
					const plugin = app.plugins.getPlugin("keepsidian") as
						| { settings?: { token?: string } }
						| undefined;
					return plugin?.settings?.token ?? "";
				});
				return token === "e2e-keep-token-mobile";
			},
			{ timeout: 20000, interval: 200 }
		);

		await restoreTokenExchange();
	});
});
