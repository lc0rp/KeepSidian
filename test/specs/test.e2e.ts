import { browser, expect } from "@wdio/globals";

describe("KeepSidian", function () {
	const buttonByText = (label: string): string =>
		`//*[self::button or @role="button"][normalize-space(.)="${label}"]`;

	const openKeepSidianSettingsTab = async (): Promise<void> => {
		await completeMobileOnboardingIfNeeded();

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

		await browser.executeObsidian(({ app }) => {
			const settingManager = app?.setting;
			if (settingManager?.openTabById) {
				settingManager.openTabById("keepsidian");
			}
		});

		const emailSetting = browser.$(
			'//*[contains(@class,"setting-item-name") and normalize-space(.)="Email"]'
		);
		await emailSetting.waitForExist({ timeout: 20000 });
	};

	const stubTokenExchange = async (keepToken: string): Promise<void> => {
		await browser.executeObsidian((_, token) => {
			(window as Window & {
				__keepsidianTestExchange?: (payload: { email?: string; oauth_token: string }) => {
					keep_token: string;
				};
			}).__keepsidianTestExchange = () => ({ keep_token: token });
		}, keepToken);
	};

	const restoreTokenExchange = async (): Promise<void> => {
		await browser.executeObsidian(() => {
			delete (window as Window & { __keepsidianTestExchange?: unknown }).__keepsidianTestExchange;
		});
	};

	const isAndroid = (): boolean => {
		const platform = (browser.capabilities as { platformName?: string }).platformName;
		return typeof platform === "string" && platform.toLowerCase() === "android";
	};

	const completeMobileOnboardingIfNeeded = async (): Promise<void> => {
		if (!isAndroid()) {
			return;
		}

		const clickIfPresent = async (label: string): Promise<boolean> => {
			const candidate = await browser.$(buttonByText(label));
			if (await candidate.isExisting()) {
				await candidate.click();
				return true;
			}
			return false;
		};

		await browser.waitUntil(
			async () => {
				const clickedExistingVault = await clickIfPresent("Use my existing vault");
				if (clickedExistingVault) {
					return false;
				}

				const clickedSkipSync = await clickIfPresent("Continue without sync");
				if (clickedSkipSync) {
					return false;
				}

				return true;
			},
			{ timeout: 30000, interval: 500 }
		);
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

		const tokenInput = browser.$('//input[@placeholder="Google Keep sync token."]');
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

		const tokenInput = browser.$('//input[@placeholder="Google Keep sync token."]');
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
