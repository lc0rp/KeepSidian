/**
 * @jest-environment jsdom
 */
import { App, PluginSettingTab, Notice, Platform } from 'obsidian';
import { KeepSidianSettingsTab } from '../KeepSidianSettingsTab';
import KeepSidianPlugin from '../../../main';
import { SubscriptionService } from 'services/subscription';
import { DEFAULT_SETTINGS } from '../../../types/keepsidian-plugin-settings';
import { exchangeOauthToken } from '../../../integrations/google/keepToken';
import { runOauthBrowserAutomation } from '../../../integrations/google/keepTokenBrowserAutomation';

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

type CreateElFn = HTMLElementWithCreateEl['createEl'];

type KeepSidianSettingsTabInternals = {
	addEmailSetting(containerEl: HTMLElement): void;
	addSyncTokenSetting(containerEl: HTMLElement): void;
	addSaveLocationSetting(containerEl: HTMLElement): void;
	addSubscriptionSettings(containerEl: HTMLElement): Promise<void>;
	createRetrieveTokenWebView(containerEl: HTMLElement): void;
	addSupportSection(containerEl: HTMLElement): void;
	isValidEmail(email: string): boolean;
	handleTokenPaste(event: ClipboardEvent): Promise<void>;
	handleAutomationLaunch(engine: 'puppeteer' | 'playwright'): Promise<void>;
};

jest.mock('../../modals/NoteImportOptionsModal', () => ({
    NoteImportOptionsModal: jest.fn().mockImplementation(() => ({
        open: jest.fn()
    }))
}));

jest.mock('../../../integrations/google/keepToken', () => ({
    exchangeOauthToken: jest.fn(),
}));

jest.mock('../../../integrations/google/keepTokenBrowserAutomation', () => ({
    runOauthBrowserAutomation: jest.fn(),
}));

function attachCreateEl(element: HTMLElement, createEl: CreateElFn): HTMLElementWithCreateEl {
	const elementWithCreate = element as HTMLElementWithCreateEl;
	elementWithCreate.createEl = createEl;
	const createDivImpl = function createDiv(
		this: HTMLElementWithCreateEl,
		options?: CreateElOptions | string,
		callback?: (el: HTMLElementWithCreateEl) => void
	) {
		return createEl.call(this, 'div', options, callback);
	};
	elementWithCreate.createDiv = createDivImpl as unknown as typeof elementWithCreate.createDiv;
	return elementWithCreate;
}

const createElImpl = function createEl(
	this: HTMLElementWithCreateEl,
	tag: string,
	opts?: CreateElOptions | string,
	callback?: (el: HTMLElementWithCreateEl) => void
): HTMLElementWithCreateEl {
	const element = attachCreateEl(document.createElement(tag), createElImpl as unknown as CreateElFn);
	if (typeof opts === 'string') {
		element.className = opts;
	} else if (opts && typeof opts === 'object') {
		const options = opts as CreateElOptions;
		if (typeof options.text === 'string') {
			element.textContent = options.text;
		} else if (options.text instanceof DocumentFragment) {
			element.appendChild(options.text);
		}
		if (options.cls) {
			const classes = Array.isArray(options.cls)
				? options.cls
				: String(options.cls)
					.split(/\s+/)
					.filter(Boolean);
			for (const cls of classes) {
				element.classList.add(String(cls));
			}
		}
		if (options.attr) {
			for (const [key, value] of Object.entries(options.attr)) {
				if (value === null) {
					element.removeAttribute(key);
				} else {
					element.setAttribute(key, String(value));
				}
			}
		}
	}
	this.appendChild(element);
	if (callback) {
		callback(element);
	}
	return element;
} as unknown as CreateElFn;

// Mock obsidian
jest.mock('obsidian', () => ({
    ...jest.requireActual('obsidian'),
    requestUrl: jest.fn(),
    Notice: jest.fn(),
    setIcon: jest.fn(),
    Platform: { isDesktopApp: true, isMobileApp: false },
}));

const mockSubscriptionService = () => {
    return {
        getEmail: jest.fn().mockReturnValue('test@example.com'),
        isSubscriptionActive: jest.fn().mockResolvedValue(true),
        getCache: jest.fn().mockReturnValue(undefined),
        setCache: jest.fn(),
        fetchSubscriptionInfo: jest.fn(),
        checkSubscription: jest.fn().mockResolvedValue({
            plan_details: { plan_id: 'test_plan' },
            metering_info: { usage: 10, limit: 100 },
        }),
    } as unknown as SubscriptionService;
};

	describe('KeepSidianSettingsTab', () => {
	    let app: App;
	    let plugin: KeepSidianPlugin;
	    let settingsTab: KeepSidianSettingsTab;
	    let settingsTabInternals: KeepSidianSettingsTabInternals;
	    let automationResult: { oauth_token: string };

    const TEST_MANIFEST = {
        id: 'keepsidian',
        name: 'KeepSidian',
        author: 'lc0rp',
        version: '0.0.1',
        minAppVersion: '0.0.1',
        description: 'Import Google Keep notes.',
    };

	    beforeEach(() => {
	        jest.resetModules();
	        jest.clearAllMocks();
	        Platform.isDesktopApp = true;
	        Platform.isMobileApp = false;
	        app = new App();
	        plugin = new KeepSidianPlugin(app, TEST_MANIFEST);
	        plugin.settings = {
            ...DEFAULT_SETTINGS,
            email: '',
            token: '',
            saveLocation: '',
            subscriptionCache: undefined,
            premiumFeatures: {
                autoSync: false,
                syncIntervalMinutes: 5,
                includeNotesTerms: [],
                excludeNotesTerms: [],
                updateTitle: false,
                suggestTags: false,
                maxTags: 5,
                tagPrefix: '',
                limitToExistingTags: false,
            },
        };
        plugin.subscriptionService = mockSubscriptionService();
        settingsTab = new KeepSidianSettingsTab(app, plugin);
        settingsTabInternals = settingsTab as unknown as KeepSidianSettingsTabInternals;
        attachCreateEl(settingsTab.containerEl, createElImpl);

        // Reset the exchangeOauthToken mock
        (exchangeOauthToken as jest.Mock).mockReset();
        (runOauthBrowserAutomation as jest.Mock).mockReset();
        automationResult = { oauth_token: 'oauth_token_value' };
        (runOauthBrowserAutomation as jest.Mock).mockResolvedValue(automationResult);
    });

    test('two-way sync defaults stay disabled for safety', () => {
        expect(DEFAULT_SETTINGS.twoWaySyncBackupAcknowledged).toBe(false);
        expect(DEFAULT_SETTINGS.twoWaySyncEnabled).toBe(false);
        expect(DEFAULT_SETTINGS.twoWaySyncAutoSyncEnabled).toBe(false);
    });

    test('should instantiate correctly', () => {
        expect(settingsTab).toBeInstanceOf(PluginSettingTab);
    });

    test('should display settings correctly', async () => {
        const spyAddEmailSetting = jest.spyOn(settingsTabInternals, 'addEmailSetting');
        const spyAddSyncTokenSetting = jest.spyOn(settingsTabInternals, 'addSyncTokenSetting');
        const spyAddSaveLocationSetting = jest.spyOn(settingsTabInternals, 'addSaveLocationSetting');
        const spyAddSubscriptionSettings = jest.spyOn(settingsTabInternals, 'addSubscriptionSettings');
        const spyCreateRetrieveTokenWebView = jest.spyOn(settingsTabInternals, 'createRetrieveTokenWebView');
        const spyAddSupportSection = jest.spyOn(settingsTabInternals, 'addSupportSection');

        await settingsTab.display();

        expect(spyAddEmailSetting).toHaveBeenCalled();
        expect(spyAddSyncTokenSetting).toHaveBeenCalled();
        expect(spyAddSaveLocationSetting).toHaveBeenCalled();
        expect(spyAddSubscriptionSettings).toHaveBeenCalled();
        expect(spyCreateRetrieveTokenWebView).toHaveBeenCalled();
        expect(spyAddSupportSection).toHaveBeenCalledTimes(2);
    });

    test('should skip retrieval webview on mobile', async () => {
        Platform.isDesktopApp = false;
        Platform.isMobileApp = true;

        const spyCreateRetrieveTokenWebView = jest.spyOn(settingsTabInternals, 'createRetrieveTokenWebView');

        await settingsTab.display();

        expect(spyCreateRetrieveTokenWebView).not.toHaveBeenCalled();
    });

    test('should validate email properly', () => {
        expect(settingsTabInternals.isValidEmail('test@example.com')).toBe(true);
        expect(settingsTabInternals.isValidEmail('invalid-email')).toBe(false);
    });

    test('should handle oauth2_4 token paste specially', async () => {
        const event = {
            preventDefault: jest.fn(),
            clipboardData: {
                getData: jest.fn().mockReturnValue('oauth2_4/token_value'),
            },
        } as unknown as ClipboardEvent;

        (exchangeOauthToken as jest.Mock).mockResolvedValue(undefined);

        await settingsTabInternals.handleTokenPaste(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(exchangeOauthToken).toHaveBeenCalledWith(settingsTab, plugin, 'oauth2_4/token_value');
    });

    test('should let non-oauth2_4 pastes through normally', async () => {
        const event = {
            preventDefault: jest.fn(),
            clipboardData: {
                getData: jest.fn().mockReturnValue('any_other_text'),
            },
        } as unknown as ClipboardEvent;

        await settingsTabInternals.handleTokenPaste(event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(exchangeOauthToken).not.toHaveBeenCalled();
    });

    test('should launch Playwright automation with system browser enabled', async () => {
        plugin.settings.email = 'test@example.com';
        const noticeMock = jest.fn();
        (Notice as jest.Mock).mockImplementation(noticeMock);

        await settingsTabInternals.handleAutomationLaunch('playwright');

        expect(runOauthBrowserAutomation).toHaveBeenCalledWith(plugin, 'playwright', {
            debug: false,
            useSystemBrowser: true,
        });
        expect(exchangeOauthToken).toHaveBeenCalledWith(settingsTab, plugin, automationResult.oauth_token);
        expect(noticeMock).not.toHaveBeenCalledWith(
            'Please enter a valid email address before launching browser automation.'
        );
    });

    test('should launch Puppeteer automation without system browser', async () => {
        plugin.settings.email = 'test@example.com';

        await settingsTabInternals.handleAutomationLaunch('puppeteer');

        expect(runOauthBrowserAutomation).toHaveBeenCalledWith(plugin, 'puppeteer', {
            debug: false,
            useSystemBrowser: false,
        });
        expect(exchangeOauthToken).toHaveBeenCalledWith(settingsTab, plugin, automationResult.oauth_token);
    });

    test('should block automation on mobile', async () => {
        Platform.isDesktopApp = false;
        Platform.isMobileApp = true;
        plugin.settings.email = 'test@example.com';

        const noticeMock = jest.fn();
        (Notice as jest.Mock).mockImplementation(noticeMock);

        await settingsTabInternals.handleAutomationLaunch('playwright');

        expect(runOauthBrowserAutomation).not.toHaveBeenCalled();
        expect(noticeMock).toHaveBeenCalledWith('Browser automation is only available on desktop.');
    });

    test('should show notice when automation is triggered without valid email', async () => {
        plugin.settings.email = '';

        const noticeMock = jest.fn();
        (Notice as jest.Mock).mockImplementation(noticeMock);

        await settingsTabInternals.handleAutomationLaunch('playwright');

        expect(noticeMock).toHaveBeenCalledWith(
            'Please enter a valid email address before launching browser automation.'
        );
    });
});
