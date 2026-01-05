/**
 * @jest-environment jsdom
 */
import { SubscriptionSettingsTab } from "../SubscriptionSettingsTab";
import { App } from "obsidian";
import KeepSidianPlugin from "../../../main";
import { PremiumFeatureSettings } from "../../../types/subscription";
import { SubscriptionService } from "services/subscription";
import { KeepSidianSettingsTab } from "../KeepSidianSettingsTab";
import { DEFAULT_SETTINGS } from "../../../types/keepsidian-plugin-settings";

// Mock KEEPSIDIAN_SERVER_URL from config.ts
jest.mock("../../../config", () => ({
	KEEPSIDIAN_SERVER_URL: "https://keepsidian.com",
}));

// Polyfill for HTMLElement.createSpan for the JSDOM environment
if (typeof HTMLElement.prototype.createSpan !== "function") {
	HTMLElement.prototype.createSpan = function (param) {
		const span = document.createElement("span");
		let cls = "";
		if (typeof param === "object" && param !== null && "cls" in param) {
			const paramCls = param.cls;
			if (typeof paramCls === "string") {
				cls = paramCls;
			} else if (Array.isArray(paramCls)) {
				cls = paramCls.join(" ");
			} else {
				cls = "";
			}
		} else if (typeof param === "string") {
			cls = param;
		}
		if (cls) {
			span.className = cls;
		}
		this.appendChild(span);
		return span;
	};
}

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
	component.setTooltip.mockImplementation((tooltip) => {
		buttonEl.setAttribute("aria-label", tooltip);
		buttonEl.setAttribute("title", tooltip);
		return component;
	});
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

function applyOptions(element: HTMLElementWithCreateEl, opts?: CreateElOptions | string): void {
	if (!opts) {
		return;
	}
	if (typeof opts === "string") {
		element.className = opts;
		return;
	}
	const { text, attr, cls } = opts;
	if (typeof text === "string") {
		element.textContent = text;
	} else if (text instanceof DocumentFragment) {
		element.appendChild(text);
	}
	if (cls) {
		const classes = Array.isArray(cls) ? cls : String(cls).split(/\s+/).filter(Boolean);
		for (const clsName of classes) {
			element.classList.add(String(clsName));
		}
	}
	if (attr) {
		for (const [key, value] of Object.entries(attr)) {
			if (value === null) {
				element.removeAttribute(key);
			} else {
				element.setAttribute(key, String(value));
			}
		}
	}
}

function createElImpl(
	this: HTMLElementWithCreateEl,
	tag: string,
	opts?: CreateElOptions | string,
	callback?: (el: HTMLElementWithCreateEl) => void
): HTMLElementWithCreateEl {
	const element = attachCreateEl(
		document.createElement(tag),
		createElImpl as unknown as CreateElFn
	);
	applyOptions(element, opts);
	this.appendChild(element);
	if (callback) {
		callback(element);
	}
	return element;
}

const typedCreateEl = createElImpl as unknown as CreateElFn;

// Mock the Setting class with controlEl support
jest.mock("obsidian", () => {
	const actual = jest.requireActual("obsidian");

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
			this.descEl.textContent = "";
			if (typeof desc === "string") {
				this.descEl.textContent = desc;
			} else {
				this.descEl.appendChild(desc);
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
			}
			return this;
		}

		addText(cb: (text: MockTextComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "text";
			this.controlEl.appendChild(inputEl);
			const component = createMockTextComponent(inputEl, typedCreateEl);
			cb(component);
			return this;
		}

		addToggle(cb: (toggle: MockToggleComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "checkbox";
			this.controlEl.appendChild(inputEl);
			const component = createMockToggleComponent(inputEl);
			cb(component);
			return this;
		}

		addButton(cb: (button: MockButtonComponent) => void) {
			const buttonEl = document.createElement("button");
			this.controlEl.appendChild(buttonEl);
			const component = createMockButtonComponent(buttonEl);
			cb(component);
			return this;
		}

		addExtraButton(cb: (extra: MockExtraButtonComponent) => void) {
			const buttonEl = document.createElement("button");
			this.controlEl.appendChild(buttonEl);
			const component = createMockExtraButtonComponent(buttonEl);
			cb(component);
			return this;
		}

		addSlider(cb: (slider: MockSliderComponent) => void) {
			const inputEl = document.createElement("input");
			inputEl.type = "range";
			this.controlEl.appendChild(inputEl);
			const component = createMockSliderComponent(inputEl, typedCreateEl);
			cb(component);
			return this;
		}
	}

	return {
		...actual,
		Setting,
	};
});

const mockSubscriptionService = () => {
	return {
		getEmail: jest.fn().mockReturnValue("test@example.com"),
		isSubscriptionActive: jest.fn().mockResolvedValue(true),
		getCache: jest.fn().mockReturnValue(undefined),
		setCache: jest.fn(),
		fetchSubscriptionInfo: jest.fn(),
		checkSubscription: jest.fn().mockResolvedValue({
			plan_details: { plan_id: "test_plan" },
			metering_info: { usage: 10, limit: 100 },
		}),
	} as unknown as SubscriptionService;
};

describe("SubscriptionSettingsTab", () => {
	let app: App;
	let containerEl: HTMLElement;
	let plugin: KeepSidianPlugin;
	let subscriptionTab: SubscriptionSettingsTab;

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
		plugin.settings = {
			...DEFAULT_SETTINGS,
			email: "",
			token: "",
			saveLocation: "",
			subscriptionCache: undefined,
			premiumFeatures: {
				autoSync: false,
				syncIntervalMinutes: 30,
				updateTitle: false,
				suggestTags: false,
				maxTags: 5,
				tagPrefix: "",
				limitToExistingTags: false,
				includeNotesTerms: [],
				excludeNotesTerms: [],
			} as PremiumFeatureSettings,
		};
		plugin.subscriptionService = mockSubscriptionService();

		const keepSidianSettingsTab = new KeepSidianSettingsTab(app, plugin);
		containerEl = keepSidianSettingsTab.containerEl;
		subscriptionTab = new SubscriptionSettingsTab(containerEl, plugin);
	});

	describe("display()", () => {
		it("should display premium settings with supporter prompt when subscription is not active", async () => {
			jest.spyOn(plugin.subscriptionService, "isSubscriptionActive").mockResolvedValue(false);

			await subscriptionTab.display();

			expect(containerEl.querySelector("em")?.textContent).toBe(
				"Support development and unlock advanced features"
			);
			expect(containerEl.textContent).toContain("Auto-tags");
			expect(containerEl.textContent).toContain("Available to project supporters");
		});

		it("should display active subscriber view when subscription is active", async () => {
			jest.spyOn(plugin.subscriptionService, "isSubscriptionActive").mockResolvedValue(true);
			jest.spyOn(plugin.subscriptionService, "checkSubscription").mockResolvedValue({
				subscription_status: "active",
				plan_details: { plan_id: "premium", features: [] },
				metering_info: { usage: 100, limit: 1000 },
				trial_or_promo: null,
			});

			await subscriptionTab.display();

			expect(containerEl.textContent).toContain("✅ active subscription");
			expect(containerEl.textContent).toContain("Auto-tags");
			expect(containerEl.textContent).not.toContain("requires a subscription");
		});
	});

	describe("Premium Features Display", () => {
		it("should display tag suggestion settings for supporters", async () => {
			jest.spyOn(plugin.subscriptionService, "isSubscriptionActive").mockResolvedValue(true);
			await subscriptionTab.display();

			expect(containerEl.textContent).toContain("Auto-tags");
			expect(containerEl.textContent).toContain("Maximum tags");
			expect(containerEl.textContent).toContain("Tag prefix");
		});

		it("should display note filtering settings for non-supporters", async () => {
			jest.spyOn(plugin.subscriptionService, "isSubscriptionActive").mockResolvedValue(false);
			await subscriptionTab.display();

			expect(containerEl.textContent).toContain("Only include notes containing");
			expect(containerEl.textContent).toContain("Exclude notes containing");
			expect(containerEl.textContent).toContain("Available to project supporters");
		});
	});

	describe("Event Handlers", () => {
		beforeEach(() => {
			(plugin.subscriptionService.isSubscriptionActive as jest.Mock).mockResolvedValue(true);
		});

		it("should handle subscription check button click", async () => {
			await subscriptionTab.display();

			// Find and simulate click on refresh button
			const refreshButton = containerEl.querySelector(
				'[aria-label="Check subscription status"]'
			) as HTMLElement;
			refreshButton?.click();

			expect(plugin.subscriptionService.checkSubscription).toHaveBeenCalled();
		});

		it("should render subscribe link for inactive users", async () => {
			(plugin.subscriptionService.isSubscriptionActive as jest.Mock).mockResolvedValue(false);

			await subscriptionTab.display();

			const subscribeLink = containerEl.querySelector(
				'a[data-keepsidian-link="subscribe"]'
			);
			expect(subscribeLink).not.toBeNull();
			expect(subscribeLink?.getAttribute("href")).toBe("https://keepsidian.com/subscribe");
			expect(subscribeLink?.getAttribute("target")).toBe("_blank");
			expect(subscribeLink?.getAttribute("rel")).toBe("noopener noreferrer");
		});
	});
});
