/**
 * @jest-environment jsdom
 */
import { App } from "obsidian";
import KeepSidianPlugin from "../../../main";
import { KeepSidianSettingsTab } from "../KeepSidianSettingsTab";
import { DEFAULT_SETTINGS } from "../../../types/keepsidian-plugin-settings";
import { initRetrieveToken } from "../../../integrations/google/keepToken";

// Custom, DOM-driven Setting mock to exercise UI interactions
jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");

	const createEl = function (this: HTMLElement, tag: string, opts?: any) {
		const el = document.createElement(tag);
		if (opts?.text) el.textContent = opts.text;
		if (opts?.attr) {
			for (const [k, v] of Object.entries(opts.attr)) {
				el.setAttribute(k, String(v));
			}
		}
		(el as any).createEl = createEl;
		this.appendChild(el);
		return el;
	};

	class Setting {
		settingEl: HTMLElement;
		constructor(containerEl: HTMLElement) {
			this.settingEl = document.createElement("div");
			(this.settingEl as any).createEl = createEl;
			containerEl.appendChild(this.settingEl);
		}
		setName(name: string) {
			this.settingEl.createEl("div", { text: name });
			return this;
		}
		setDesc(desc: string) {
			this.settingEl.createEl("div", { text: String(desc) });
			return this;
		}
		setClass(cls: string) {
			this.settingEl.classList.add(cls);
			return this;
		}
		setDisabled(disabled: boolean) {
			if (disabled) this.settingEl.classList.add("is-disabled");
			return this;
		}

		addText(cb: (text: any) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "text";
			this.settingEl.appendChild(inputEl);
			(inputEl as any).parentElement!.createEl = createEl;
			const text = {
				inputEl,
				setPlaceholder: jest.fn(() => text),
				setValue: jest.fn((val: string) => {
					inputEl.value = val;
					return text;
				}),
				onChange: jest.fn((fn: (v: string) => void) => {
					inputEl.addEventListener("input", () => fn(inputEl.value));
					return text;
				}),
			} as any;
			cb(text);
			return this;
		}

		addToggle(cb: (toggle: any) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "checkbox";
			this.settingEl.appendChild(inputEl);
			const toggle = {
				setValue: jest.fn((v: boolean) => {
					inputEl.checked = v;
					return toggle;
				}),
				onChange: jest.fn((fn: (v: boolean) => void) => {
					inputEl.addEventListener("change", () =>
						fn(inputEl.checked)
					);
					return toggle;
				}),
			} as any;
			cb(toggle);
			return this;
		}

		addButton(cb: (button: any) => void) {
			const buttonEl = document.createElement("button");
			this.settingEl.appendChild(buttonEl);
			const button = {
				setButtonText: jest.fn((t: string) => {
					buttonEl.textContent = t;
					return button;
				}),
				setCta: jest.fn(() => button),
				onClick: jest.fn((fn: () => void) => {
					buttonEl.addEventListener("click", fn);
					return button;
				}),
			} as any;
			cb(button);
			return this;
		}

		addExtraButton(cb: (extra: any) => void) {
			const btnEl = document.createElement("button");
			this.settingEl.appendChild(btnEl);
			const extra = {
				setIcon: jest.fn(() => extra),
				setTooltip: jest.fn(() => extra),
				onClick: jest.fn(() => extra),
			} as any;
			cb(extra);
			return this;
		}

		addSlider(cb: (slider: any) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "range";
			this.settingEl.appendChild(inputEl);
			const slider = {
				setLimits: jest.fn(() => slider),
				setValue: jest.fn((v: number) => {
					(inputEl as any).value = String(v);
					return slider;
				}),
				setDynamicTooltip: jest.fn(() => slider),
				onChange: jest.fn((fn: (v: number) => void) => {
					inputEl.addEventListener("input", () =>
						fn(Number((inputEl as any).value))
					);
					return slider;
				}),
			} as any;
			cb(slider);
			return this;
		}
	}

	class PluginSettingTab extends actual.PluginSettingTab {
		constructor(app: any, plugin: any) {
			super(app, plugin);
			(this.containerEl as any).createEl = createEl;
		}
	}

	return {
		...actual,
		Setting,
		PluginSettingTab,
	};
});

jest.mock("../../../integrations/google/keepToken", () => ({
	initRetrieveToken: jest.fn(),
	exchangeOauthToken: jest.fn(),
}));

describe("KeepSidianSettingsTab UI interactions", () => {
	let app: App;
	let plugin: KeepSidianPlugin;
	let tab: KeepSidianSettingsTab;

	const TEST_MANIFEST = {
		id: "keepsidian",
		name: "KeepSidian",
		author: "lc0rp",
		version: "0.0.1",
		minAppVersion: "0.0.1",
		description: "Import Google Keep notes.",
	};

	beforeEach(() => {
		jest.clearAllMocks();
		app = new App();
		plugin = new KeepSidianPlugin(app, TEST_MANIFEST);
		plugin.settings = { ...DEFAULT_SETTINGS };
		// Spy start/stop to avoid timers
		plugin.startAutoSync = jest.fn();
		plugin.stopAutoSync = jest.fn();
		// Mock subscription service
		plugin.subscriptionService = {
			isSubscriptionActive: jest.fn().mockResolvedValue(true),
			getEmail: jest.fn(),
			getCache: jest.fn(),
			setCache: jest.fn(),
			fetchSubscriptionInfo: jest.fn(),
			checkSubscription: jest.fn(),
		} as any;
		tab = new KeepSidianSettingsTab(app, plugin);
	});

	test("token field show/hide toggle and onChange save", async () => {
		const container = tab.containerEl;
		await (tab as any).addSyncTokenSetting(container);

		// Find the token input created by addText in sync token setting
		const tokenInput = container.querySelector("input") as HTMLInputElement;
		expect(tokenInput).toBeTruthy();

		// Initially set to password by implementation
		// Simulate the implementation changing to password (since our mock defaults to text)
		tokenInput.type = "password";

		// Toggle show/hide
		const showBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Show"
		) as HTMLButtonElement;
		expect(showBtn).toBeTruthy();
		showBtn.click();
		expect(tokenInput.type).toBe("text");
		expect(showBtn.textContent).toBe("Hide");
		showBtn.click();
		expect(tokenInput.type).toBe("password");
		expect(showBtn.textContent).toBe("Show");

		// Trigger onChange for token value save
		tokenInput.value = "new-token";
		tokenInput.dispatchEvent(new Event("input"));
		expect(plugin.settings.token).toBe("new-token");
	});

	test("retrieve token button calls flow with valid email and github open button exists", async () => {
		plugin.settings.email = "test@example.com";

		const container = tab.containerEl;
		await (tab as any).addSyncTokenSetting(container);

		const retrieveBtn = Array.from(
			container.querySelectorAll("button")
		).find(
			(b) => b.textContent === "Retrieval wizard"
		) as HTMLButtonElement;
		expect(retrieveBtn).toBeTruthy();
		retrieveBtn.click();
		expect(initRetrieveToken).toHaveBeenCalled();

		// Also ensure the GitHub instructions button exists
		const githubBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Github KIM instructions"
		);
		expect(githubBtn).toBeTruthy();
	});

	test("save location onChange persists value", async () => {
		const container = tab.containerEl;
		await (tab as any).addSaveLocationSetting(container);
		const input = container.querySelector("input") as HTMLInputElement;
		input.value = "KeepSidian/Subfolder";
		input.dispatchEvent(new Event("input"));
		expect(plugin.settings.saveLocation).toBe("KeepSidian/Subfolder");
	});

	test("auto sync toggle starts and stops appropriately", async () => {
		const container = tab.containerEl;
		await (tab as any).addAutoSyncSettings(container);
		const checkbox = container.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement;

		// Enable
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event("change"));
		await new Promise((r) => setTimeout(r, 0));
		expect(plugin.startAutoSync).toHaveBeenCalled();

		// Disable
		checkbox.checked = false;
		checkbox.dispatchEvent(new Event("change"));
		await new Promise((r) => setTimeout(r, 0));
		expect(plugin.stopAutoSync).toHaveBeenCalled();
	});

	test("sync interval edits and triggers restart when enabled, gated for non-subscribers", async () => {
		// First, subscriber path
		(
			plugin.subscriptionService.isSubscriptionActive as jest.Mock
		).mockResolvedValue(true);
		const container = tab.containerEl;
		await (tab as any).addAutoSyncSettings(container);
		const textInputs = Array.from(
			container.querySelectorAll("input")
		).filter((i) => i.type === "text") as HTMLInputElement[];
		const intervalInput = textInputs[textInputs.length - 1];

		plugin.settings.autoSyncEnabled = true;
		intervalInput.value = "12";
		intervalInput.dispatchEvent(new Event("input"));
		await new Promise((r) => setTimeout(r, 0));
		expect(plugin.settings.autoSyncIntervalHours).toBe(12);
		expect(plugin.startAutoSync).toHaveBeenCalled();

		// Now, non-subscriber path adds disabled + requires-subscription classes
		const container2 = document.createElement("div");
		(container2 as any).createEl = (tag: string, opts?: any) => {
			const el = document.createElement(tag);
			if (opts?.text) el.textContent = opts.text;
			(el as any).createEl = (container as any).createEl;
			container2.appendChild(el);
			return el;
		};
		(
			plugin.subscriptionService.isSubscriptionActive as jest.Mock
		).mockResolvedValue(false);
		await (tab as any).addAutoSyncSettings(container2);
		const disabledSetting = container2.querySelector(
			".requires-subscription"
		);
		expect(disabledSetting).toBeTruthy();
	});
});
