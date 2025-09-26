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

const getSettingsTabInternals = (
	instance: KeepSidianSettingsTab
): KeepSidianSettingsTabInternals =>
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

const createMockToggleComponent = (
	inputEl: HTMLInputElement
): MockToggleComponent => {
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

const createMockButtonComponent = (
	buttonEl: HTMLButtonElement
): MockButtonComponent => {
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

const createMockExtraButtonComponent = (
	buttonEl: HTMLButtonElement
): MockExtraButtonComponent => {
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
		inputEl.addEventListener("input", () =>
			handler(Number(inputEl.value))
		);
		return component;
	});

	const parentElement = inputEl.parentElement;
	if (parentElement) {
		attachCreateEl(parentElement, createEl);
	}

	return component;
};

function attachCreateEl(
	element: HTMLElement,
	createEl: CreateElFn
): HTMLElementWithCreateEl {
	const elementWithCreate = element as HTMLElementWithCreateEl;
	elementWithCreate.createEl = createEl;
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
		const elementWithCreate = attachCreateEl(
			element,
			typedCreateEl
		);
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
					: [options.cls];
				for (const cls of classes) {
					if (cls) {
						elementWithCreate.classList.add(String(cls));
					}
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
		constructor(containerEl: HTMLElement) {
			attachCreateEl(containerEl, typedCreateEl);
			this.settingEl = attachCreateEl(
				document.createElement("div"),
				typedCreateEl
			);
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
			if (disabled) {
				this.settingEl.classList.add("is-disabled");
			}
			return this;
		}

		addText(cb: (text: MockTextComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "text";
			this.settingEl.appendChild(inputEl);
			const textComponent = createMockTextComponent(
				inputEl,
				typedCreateEl
			);
			cb(textComponent);
			return this;
		}

		addToggle(cb: (toggle: MockToggleComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "checkbox";
			this.settingEl.appendChild(inputEl);
			const toggleComponent = createMockToggleComponent(inputEl);
			cb(toggleComponent);
			return this;
		}

		addButton(cb: (button: MockButtonComponent) => void) {
			const buttonEl = document.createElement("button");
			this.settingEl.appendChild(buttonEl);
			const buttonComponent = createMockButtonComponent(
				buttonEl
			);
			cb(buttonComponent);
			return this;
		}

		addExtraButton(cb: (extra: MockExtraButtonComponent) => void) {
			const buttonEl = document.createElement("button");
			this.settingEl.appendChild(buttonEl);
			const extraComponent = createMockExtraButtonComponent(buttonEl);
			cb(extraComponent);
			return this;
		}

		addSlider(cb: (slider: MockSliderComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "range";
			this.settingEl.appendChild(inputEl);
			const sliderComponent = createMockSliderComponent(
				inputEl,
				typedCreateEl
			);
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
			isSubscriptionActive:
				jest.fn<Promise<boolean>, [boolean?]>().mockResolvedValue(true),
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

	test("retrieve token button calls flow with valid email and github open button exists", async () => {
		plugin.settings.email = "test@example.com";

		const container = tab.containerEl;
		await tabInternals.addSyncTokenSetting(container);

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
		await tabInternals.addSaveLocationSetting(container);
		const input = container.querySelector("input") as HTMLInputElement;
		input.value = "KeepSidian/Subfolder";
		input.dispatchEvent(new Event("input"));
		expect(plugin.settings.saveLocation).toBe("KeepSidian/Subfolder");
	});

	test("auto sync toggle starts and stops appropriately", async () => {
		const container = tab.containerEl;
		await tabInternals.addAutoSyncSettings(container);
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
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(true);
		const container = tab.containerEl;
		await tabInternals.addAutoSyncSettings(container);
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
		const containerWithCreate = tab.containerEl as HTMLElementWithCreateEl;
		const secondaryContainer = document.createElement("div") as HTMLElementWithCreateEl;
		secondaryContainer.createEl = containerWithCreate.createEl;
		containerWithCreate.appendChild(secondaryContainer);
		subscriptionServiceMock.isSubscriptionActive.mockResolvedValue(false);
		await tabInternals.addAutoSyncSettings(secondaryContainer);
		const disabledSetting = secondaryContainer.querySelector(
			".requires-subscription"
		);
		expect(disabledSetting).toBeTruthy();
	});
});
