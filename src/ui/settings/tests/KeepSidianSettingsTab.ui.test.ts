/**
 * @jest-environment jsdom
 */
import { App } from "obsidian";
import KeepSidianPlugin from "../../../main";
import { KeepSidianSettingsTab } from "../KeepSidianSettingsTab";
import { DEFAULT_SETTINGS } from "../../../types/keepsidian-plugin-settings";
import { initRetrieveToken } from "../../../integrations/google/keepToken";

type CreateElOptions = {
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	cls?: string | string[];
};

type HTMLElementWithCreateEl = HTMLElement & {
	createEl(
		this: HTMLElementWithCreateEl,
		tag: string,
		options?: CreateElOptions | string,
		callback?: (el: HTMLElementWithCreateEl) => void
	): HTMLElementWithCreateEl;
	createDiv(
		this: HTMLElementWithCreateEl,
		options?: CreateElOptions | string,
		callback?: (el: HTMLElementWithCreateEl) => void
	): HTMLElementWithCreateEl;
};

type CreateElFn = HTMLElementWithCreateEl["createEl"];

type ChangeHandler<T> = (value: T) => void;

interface MockTextComponent {
	inputEl: HTMLInputElement;
	setPlaceholder: jest.Mock<MockTextComponent, [string]>;
	setValue: jest.Mock<MockTextComponent, [string]>;
	onChange: jest.Mock<MockTextComponent, [ChangeHandler<string>]>;
}

interface MockToggleComponent {
	setValue: jest.Mock<MockToggleComponent, [boolean]>;
	onChange: jest.Mock<MockToggleComponent, [ChangeHandler<boolean>]>;
}

interface MockButtonComponent {
	setButtonText: jest.Mock<MockButtonComponent, [string]>;
	setCta: jest.Mock<MockButtonComponent, []>;
	onClick: jest.Mock<MockButtonComponent, [() => void]>;
}

interface MockExtraButtonComponent {
	setIcon: jest.Mock<MockExtraButtonComponent, [string]>;
	setTooltip: jest.Mock<MockExtraButtonComponent, [string]>;
	onClick: jest.Mock<MockExtraButtonComponent, [() => void]>;
}

interface MockSliderComponent {
	setLimits: jest.Mock<MockSliderComponent, [number, number, number?]>;
	setValue: jest.Mock<MockSliderComponent, [number]>;
	setDynamicTooltip: jest.Mock<MockSliderComponent, [boolean?]>;
	onChange: jest.Mock<MockSliderComponent, [ChangeHandler<number>]>;
}

interface SubscriptionServiceMock {
	isSubscriptionActive: jest.Mock<Promise<boolean>, [boolean?]>;
	getEmail: jest.Mock<string | undefined, []>;
	getCache: jest.Mock<unknown, []>;
	setCache: jest.Mock<Promise<void>, [unknown]>;
	fetchSubscriptionInfo: jest.Mock<Promise<unknown>, [string]>;
	checkSubscription: jest.Mock<Promise<unknown>, [boolean?]>;
}

type KeepSidianSettingsTabInternals = {
	addSyncTokenSetting(containerEl: HTMLElement): Promise<void> | void;
	addSaveLocationSetting(containerEl: HTMLElement): Promise<void> | void;
	addAutoSyncSettings(containerEl: HTMLElement): Promise<void>;
};

const getSettingsTabInternals = (instance: KeepSidianSettingsTab): KeepSidianSettingsTabInternals =>
	instance as unknown as KeepSidianSettingsTabInternals;

const createMockTextComponent = (
	inputEl: HTMLInputElement,
	createEl: CreateElFn
): MockTextComponent => {
	const component: MockTextComponent = {
		inputEl,
		setPlaceholder: jest.fn(),
		setValue: jest.fn(),
		onChange: jest.fn(),
	};

	component.setPlaceholder.mockImplementation(() => component);
	component.setValue.mockImplementation((value) => {
		inputEl.value = value;
		return component;
	});
	component.onChange.mockImplementation((handler) => {
		inputEl.addEventListener("input", () => handler(inputEl.value));
		return component;
	});

	const parentElement = inputEl.parentElement;
	if (parentElement) {
		attachCreateEl(parentElement, createEl);
	}

	return component;
};

const createMockToggleComponent = (inputEl: HTMLInputElement): MockToggleComponent => {
	const component: MockToggleComponent = {
		setValue: jest.fn(),
		onChange: jest.fn(),
	};

	component.setValue.mockImplementation((value) => {
		inputEl.checked = value;
		return component;
	});
	component.onChange.mockImplementation((handler) => {
		inputEl.addEventListener("change", () => handler(inputEl.checked));
		return component;
	});

	return component;
};

const createMockButtonComponent = (buttonEl: HTMLButtonElement): MockButtonComponent => {
	const component: MockButtonComponent = {
		setButtonText: jest.fn(),
		setCta: jest.fn(),
		onClick: jest.fn(),
	};

	component.setButtonText.mockImplementation((text) => {
		buttonEl.textContent = text;
		return component;
	});
	component.setCta.mockImplementation(() => component);
	component.onClick.mockImplementation((handler) => {
		buttonEl.addEventListener("click", handler);
		return component;
	});

	return component;
};

const createMockExtraButtonComponent = (buttonEl: HTMLButtonElement): MockExtraButtonComponent => {
	const component: MockExtraButtonComponent = {
		setIcon: jest.fn(),
		setTooltip: jest.fn(),
		onClick: jest.fn(),
	};

	component.setIcon.mockImplementation(() => component);
	component.setTooltip.mockImplementation(() => component);
	component.onClick.mockImplementation((handler) => {
		buttonEl.addEventListener("click", handler);
		return component;
	});

	return component;
};

const createMockSliderComponent = (
	inputEl: HTMLInputElement,
	createEl: CreateElFn
): MockSliderComponent => {
	const component: MockSliderComponent = {
		setLimits: jest.fn(),
		setValue: jest.fn(),
		setDynamicTooltip: jest.fn(),
		onChange: jest.fn(),
	};

	component.setLimits.mockImplementation(() => component);
	component.setValue.mockImplementation((value) => {
		inputEl.value = String(value);
		return component;
	});
	component.setDynamicTooltip.mockImplementation(() => component);
	component.onChange.mockImplementation((handler) => {
		inputEl.addEventListener("input", () => handler(Number(inputEl.value)));
		return component;
	});

	const parentElement = inputEl.parentElement;
	if (parentElement) {
		attachCreateEl(parentElement, createEl);
	}

	return component;
};

function attachCreateEl(element: HTMLElement, createEl: CreateElFn): HTMLElementWithCreateEl {
	const elementWithCreate = element as HTMLElementWithCreateEl;
	elementWithCreate.createEl = createEl;
	const createDivImpl = function createDiv(
		this: HTMLElementWithCreateEl,
		options?: CreateElOptions | string,
		callback?: (el: HTMLElementWithCreateEl) => void
	) {
		return createEl.call(this, "div", options, callback);
	};
	elementWithCreate.createDiv = createDivImpl as unknown as typeof elementWithCreate.createDiv;
	return elementWithCreate;
}

// Custom, DOM-driven Setting mock to exercise UI interactions

jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");

	function createElImpl(
		this: HTMLElementWithCreateEl,
		tag: string,
		opts?: CreateElOptions | string,
		callback?: (el: HTMLElementWithCreateEl) => void
	): HTMLElementWithCreateEl {
		const element = document.createElement(tag);
		const elementWithCreate = attachCreateEl(element, typedCreateEl);
		if (typeof opts === "string") {
			elementWithCreate.className = opts;
		} else if (opts && typeof opts === "object") {
			const options = opts as CreateElOptions;
			if (typeof options.text === "string") {
				elementWithCreate.textContent = options.text;
			} else if (options.text instanceof DocumentFragment) {
				elementWithCreate.appendChild(options.text);
			}
			if (options.cls) {
				const classes = Array.isArray(options.cls)
					? options.cls
					: String(options.cls).split(/\s+/).filter(Boolean);
				for (const cls of classes) {
					elementWithCreate.classList.add(String(cls));
				}
			}
			if (options.attr) {
				for (const [key, value] of Object.entries(options.attr)) {
					if (value === null) {
						elementWithCreate.removeAttribute(key);
					} else {
						elementWithCreate.setAttribute(key, String(value));
					}
				}
			}
		}
		this.appendChild(elementWithCreate);
		if (callback) {
			callback(elementWithCreate);
		}
		return elementWithCreate;
	}

	const typedCreateEl = createElImpl as unknown as CreateElFn;

	class Setting {
		settingEl: HTMLElementWithCreateEl;
		private infoEl: HTMLElementWithCreateEl;
		private nameEl?: HTMLElementWithCreateEl;
		private descEl?: HTMLElementWithCreateEl;
		controlEl: HTMLElementWithCreateEl;
		constructor(containerEl: HTMLElement) {
			attachCreateEl(containerEl, typedCreateEl);
			this.settingEl = attachCreateEl(document.createElement("div"), typedCreateEl);
			this.settingEl.classList.add("setting-item");
			this.infoEl = attachCreateEl(document.createElement("div"), typedCreateEl);
			this.infoEl.classList.add("setting-item-info");
			this.settingEl.appendChild(this.infoEl);
			this.controlEl = attachCreateEl(document.createElement("div"), typedCreateEl);
			this.controlEl.classList.add("setting-item-control");
			this.settingEl.appendChild(this.controlEl);
			containerEl.appendChild(this.settingEl);
		}
		setName(name: string) {
			if (!this.nameEl) {
				this.nameEl = this.infoEl.createEl("div", { cls: "setting-item-name" });
			}
			this.nameEl.textContent = name;
			return this;
		}
		setDesc(desc: string | DocumentFragment) {
			if (!this.descEl) {
				this.descEl = this.infoEl.createEl("div", { cls: "setting-item-description" });
			}
			if (this.descEl) {
				this.descEl.textContent = "";
				if (typeof desc === "string") {
					this.descEl.textContent = desc;
				} else {
					this.descEl.appendChild(desc);
				}
			}
			return this;
		}
		setClass(cls: string) {
			this.settingEl.classList.add(cls);
			return this;
		}
		setHeading() {
			this.settingEl.classList.add("setting-heading");
			return this;
		}
		setDisabled(disabled: boolean) {
			if (disabled) {
				this.settingEl.classList.add("is-disabled");
			} else {
				this.settingEl.classList.remove("is-disabled");
			}
			const actionableEls = this.controlEl.querySelectorAll(
				"input, button, select"
			) as NodeListOf<HTMLElement & { disabled?: boolean }>;
			actionableEls.forEach((element) => {
				element.disabled = disabled;
			});
			return this;
		}

		addText(cb: (text: MockTextComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "text";
			this.controlEl.appendChild(inputEl);
			const textComponent = createMockTextComponent(inputEl, typedCreateEl);
			cb(textComponent);
			return this;
		}

		addToggle(cb: (toggle: MockToggleComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "checkbox";
			this.controlEl.appendChild(inputEl);
			const toggleComponent = createMockToggleComponent(inputEl);
			cb(toggleComponent);
			return this;
		}

		addButton(cb: (button: MockButtonComponent) => void) {
			const buttonEl = document.createElement("button");
			this.controlEl.appendChild(buttonEl);
			const buttonComponent = createMockButtonComponent(buttonEl);
			cb(buttonComponent);
			return this;
		}

		addExtraButton(cb: (extra: MockExtraButtonComponent) => void) {
			const buttonEl = document.createElement("button");
			this.controlEl.appendChild(buttonEl);
			const extraComponent = createMockExtraButtonComponent(buttonEl);
			cb(extraComponent);
			return this;
		}

		addSlider(cb: (slider: MockSliderComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "range";
			this.controlEl.appendChild(inputEl);
			const sliderComponent = createMockSliderComponent(inputEl, typedCreateEl);
			cb(sliderComponent);
			return this;
		}
	}

	class PluginSettingTab extends actual.PluginSettingTab {
		constructor(app: App, plugin: KeepSidianPlugin) {
			super(app, plugin);
			attachCreateEl(this.containerEl, typedCreateEl);
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
	let tabInternals: KeepSidianSettingsTabInternals;
	let subscriptionServiceMock: SubscriptionServiceMock;

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
		subscriptionServiceMock = {
			isSubscriptionActive: jest.fn<Promise<boolean>, [boolean?]>().mockResolvedValue(true),
			getEmail: jest.fn<string | undefined, []>(),
			getCache: jest.fn<unknown, []>(),
			setCache: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
			fetchSubscriptionInfo: jest.fn<Promise<unknown>, [string]>(),
			checkSubscription: jest.fn<Promise<unknown>, [boolean?]>(),
		};
		plugin.subscriptionService =
			subscriptionServiceMock as unknown as KeepSidianPlugin["subscriptionService"];
		tab = new KeepSidianSettingsTab(app, plugin);
		tabInternals = getSettingsTabInternals(tab);
	});

	const waitForAsync = async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	};

	const findSettingByLabel = (
		container: HTMLElement,
		label: string
	): HTMLElementWithCreateEl | null => {
		const items = Array.from(
			container.querySelectorAll(".setting-item")
		) as HTMLElementWithCreateEl[];
		return (
			items.find((item) => {
				const nameEl = item.querySelector(".setting-item-name") as HTMLElement | null;
				return nameEl?.textContent === label;
			}) ?? null
		);
	};

	test("token field show/hide toggle and onChange save", async () => {
		const container = tab.containerEl;
		await tabInternals.addSyncTokenSetting(container);

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

	test("retrieve token button calls flow with valid email and github instructions link exists", async () => {
		plugin.settings.email = "test@example.com";

		const container = tab.containerEl;
		await tabInternals.addSyncTokenSetting(container);

		const retrieveBtn = Array.from(container.querySelectorAll("button")).find(
			(b) => b.textContent === "Retrieval wizard"
		) as HTMLButtonElement;
		expect(retrieveBtn).toBeTruthy();
		retrieveBtn.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(initRetrieveToken).toHaveBeenCalled();

		// Also ensure the GitHub instructions link exists
		const githubLink = container.querySelector(
			'a[data-keepsidian-link="github-instructions"]'
		) as HTMLAnchorElement | null;
		expect(githubLink).not.toBeNull();
		expect(githubLink?.getAttribute("href")).toBe(
			"https://github.com/djsudduth/keep-it-markdown"
		);
	});

	test("save location onChange persists value", async () => {
		const container = tab.containerEl;
		await tabInternals.addSaveLocationSetting(container);
		const input = container.querySelector("input") as HTMLInputElement;
		input.value = "KeepSidian/Subfolder";
		input.dispatchEvent(new Event("input"));
		expect(plugin.settings.saveLocation).toBe("KeepSidian/Subfolder");
	});

	test("auto sync toggle starts and stops appropriately", async () => {
		const container = tab.containerEl;
		await tabInternals.addAutoSyncSettings(container);
		const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

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
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		const container = tab.containerEl;
		await tabInternals.addAutoSyncSettings(container);
		const textInputs = Array.from(container.querySelectorAll("input")).filter(
			(i) => i.type === "text"
		) as HTMLInputElement[];
		const intervalInput = textInputs[textInputs.length - 1];

		plugin.settings.autoSyncEnabled = true;
		intervalInput.value = "12";
		intervalInput.dispatchEvent(new Event("input"));
		await new Promise((r) => setTimeout(r, 0));
		expect(plugin.settings.autoSyncIntervalHours).toBe(12);
		expect(plugin.startAutoSync).toHaveBeenCalled();

		// Now, non-subscriber path adds disabled + requires-subscription classes
		const containerWithCreate = tab.containerEl as HTMLElementWithCreateEl;
		const secondaryContainer = document.createElement("div") as HTMLElementWithCreateEl;
		secondaryContainer.createEl = containerWithCreate.createEl;
		containerWithCreate.appendChild(secondaryContainer);
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(false);
		await tabInternals.addAutoSyncSettings(secondaryContainer);
		const disabledSetting = secondaryContainer.querySelector(".requires-subscription");
		expect(disabledSetting).toBeTruthy();
	});

	test("two-way sync beta toggles default to safe disabled state", async () => {
		const container = tab.containerEl;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		await tabInternals.addAutoSyncSettings(container);

		const manualSetting = findSettingByLabel(container, "Enable two-way sync");
		const autoSetting = findSettingByLabel(container, "Enable two-way background sync");

		expect(manualSetting?.classList.contains("is-disabled")).toBe(true);
		expect(autoSetting?.classList.contains("is-disabled")).toBe(true);

		const manualDesc = manualSetting?.querySelector(".setting-item-description")?.textContent;
		expect(manualDesc).toContain("Please opt-in above to activate");
		const autoDesc = autoSetting?.querySelector(".setting-item-description")?.textContent;
		expect(autoDesc).toContain("requires opt-in above");
	});

	test("acknowledging backups unlocks manual two-way toggle", async () => {
		const container = tab.containerEl;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		await tabInternals.addAutoSyncSettings(container);

		const backupSetting = findSettingByLabel(container, "Confirm opt in");
		const manualSetting = findSettingByLabel(container, "Enable two-way sync");

		const backupToggle = backupSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;
		expect(backupToggle).toBeDefined();
		if (!backupToggle) {
			throw new Error("Backup toggle not found");
		}
		backupToggle.checked = true;
		backupToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.twoWaySyncBackupAcknowledged).toBe(true);
		expect(manualSetting?.classList.contains("is-disabled")).toBe(false);
	});

	test("renders backup guidance button", async () => {
		const container = tab.containerEl;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		await tabInternals.addAutoSyncSettings(container);

		const backupLink = container.querySelector(
			'a[data-keepsidian-link="obsidian-backup-guide"]'
		) as HTMLAnchorElement | null;
		expect(backupLink).not.toBeNull();
		expect(backupLink?.textContent).toBe("🌎 Obsidian backup guide");
		expect(backupLink?.getAttribute("target")).toBe("_blank");
		expect(backupLink?.classList.contains("keepsidian-link-button")).toBe(true);
	});

	test("manual opt-in and prerequisites enable auto two-way toggle", async () => {
		const container = tab.containerEl;
		plugin.settings.autoSyncEnabled = true;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		await tabInternals.addAutoSyncSettings(container);

		const backupSetting = findSettingByLabel(container, "Confirm opt in");
		const manualSetting = findSettingByLabel(container, "Enable two-way sync");
		const autoSetting = findSettingByLabel(container, "Enable two-way background sync");

		const backupToggle = backupSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;
		const manualToggle = manualSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;
		const autoToggle = autoSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;

		if (!backupToggle || !manualToggle || !autoToggle) {
			throw new Error("Two-way toggle inputs missing");
		}

		backupToggle.checked = true;
		backupToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(autoSetting?.classList.contains("is-disabled")).toBe(true);
		const autoDescBefore = autoSetting?.querySelector(".setting-item-description")?.textContent;
		expect(autoDescBefore).toContain("requires two-way sync");

		manualToggle.checked = true;
		manualToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.twoWaySyncEnabled).toBe(true);
		expect(autoSetting?.classList.contains("is-disabled")).toBe(false);

		autoToggle.checked = true;
		autoToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.twoWaySyncAutoSyncEnabled).toBe(true);
		const autoDescAfter = autoSetting?.querySelector(".setting-item-description")?.textContent;
		expect(autoDescAfter).toContain("Background sync will run uploads and downloads together");
	});

	test("background sync toggle refreshes auto two-way prerequisites", async () => {
		const container = tab.containerEl;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		plugin.settings.twoWaySyncBackupAcknowledged = true;
		plugin.settings.twoWaySyncEnabled = true;
		plugin.settings.twoWaySyncAutoSyncEnabled = true;

		await tabInternals.addAutoSyncSettings(container);

		const autoSyncSetting = findSettingByLabel(container, "Enable background sync");
		const autoSetting = findSettingByLabel(container, "Enable two-way background sync");
		if (!autoSyncSetting || !autoSetting) {
			throw new Error("Background sync settings not rendered");
		}
		const autoSyncToggle = autoSyncSetting.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;
		const autoToggle = autoSetting.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;

		if (!autoSyncToggle || !autoToggle) {
			throw new Error("Auto sync prerequisites inputs missing");
		}

		const autoDescBefore = autoSetting.querySelector(".setting-item-description")?.textContent;
		expect(autoSetting.classList.contains("is-disabled")).toBe(true);
		expect(autoDescBefore).toContain("requires background sync");

		autoSyncToggle.checked = true;
		autoSyncToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.autoSyncEnabled).toBe(true);
		expect(autoSetting.classList.contains("is-disabled")).toBe(false);
		expect(autoToggle.checked).toBe(true);
		const autoDescAfterEnable = autoSetting.querySelector(
			".setting-item-description"
		)?.textContent;
		expect(autoDescAfterEnable).toContain("Background sync will run uploads and downloads together");

		autoSyncToggle.checked = false;
		autoSyncToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.autoSyncEnabled).toBe(false);
		const autoDescAfterDisable = autoSetting.querySelector(
			".setting-item-description"
		)?.textContent;
		expect(autoDescAfterDisable).toContain("requires background sync");
		expect(autoSetting.classList.contains("is-disabled")).toBe(true);
	});

	test("disabling backups resets two-way selections", async () => {
		const container = tab.containerEl;
		plugin.settings.autoSyncEnabled = true;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		await tabInternals.addAutoSyncSettings(container);

		const backupSetting = findSettingByLabel(container, "Confirm opt in");
		const manualSetting = findSettingByLabel(container, "Enable two-way sync");
		const autoSetting = findSettingByLabel(container, "Enable two-way background sync");

		const backupToggle = backupSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;
		const manualToggle = manualSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;
		const autoToggle = autoSetting?.querySelector('input[type="checkbox"]') as
			| HTMLInputElement
			| undefined;

		if (!backupToggle || !manualToggle || !autoToggle) {
			throw new Error("Two-way toggle inputs missing");
		}

		backupToggle.checked = true;
		backupToggle.dispatchEvent(new Event("change"));
		manualToggle.checked = true;
		manualToggle.dispatchEvent(new Event("change"));
		autoToggle.checked = true;
		autoToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.twoWaySyncAutoSyncEnabled).toBe(true);

		backupToggle.checked = false;
		backupToggle.dispatchEvent(new Event("change"));
		await waitForAsync();

		expect(plugin.settings.twoWaySyncBackupAcknowledged).toBe(false);
		expect(plugin.settings.twoWaySyncEnabled).toBe(false);
		expect(plugin.settings.twoWaySyncAutoSyncEnabled).toBe(false);
		expect(manualSetting?.classList.contains("is-disabled")).toBe(true);
		expect(autoSetting?.classList.contains("is-disabled")).toBe(true);
		expect(autoToggle.checked).toBe(false);
	});

	test("non-premium users see locked auto two-way toggle", async () => {
		const container = tab.containerEl;
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(false);
		await tabInternals.addAutoSyncSettings(container);

		const autoSetting = findSettingByLabel(container, "Enable two-way background sync");
		expect(autoSetting).not.toBeNull();
		expect(autoSetting?.classList.contains("requires-subscription")).toBe(true);
		const autoDesc = autoSetting?.querySelector(".setting-item-description")?.textContent;
		expect(autoDesc).toContain("Available to project supporters");
	});
});
