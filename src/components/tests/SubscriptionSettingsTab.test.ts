/**
 * @jest-environment jsdom
 */
import { SubscriptionSettingsTab } from '../SubscriptionSettingsTab';
import { Setting, App } from 'obsidian';
import KeepSidianPlugin from '../../main';
import { PremiumFeatureSettings } from '../../types/subscription';
import { SubscriptionService } from 'services/subscription';
import { KeepSidianSettingsTab } from '../KeepSidianSettingsTab';

// Mock KEEPSIDIAN_SERVER_URL from config.ts
jest.mock('../../config', () => ({
    KEEPSIDIAN_SERVER_URL: 'https://keepsidian.com'
}));

// Polyfill for HTMLElement.createSpan for the JSDOM environment
if (typeof HTMLElement.prototype.createSpan !== 'function') {
    HTMLElement.prototype.createSpan = function(param) {
        const span = document.createElement('span');
        let cls = "";
        if (typeof param === 'object' && param !== null && 'cls' in param) {
            const paramCls = param.cls;
            if (typeof paramCls === 'string') {
                cls = paramCls;
            } else if (Array.isArray(paramCls)) {
                cls = paramCls.join(" ");
            } else {
                cls = "";
            }
        } else if (typeof param === 'string') {
            cls = param;
        }
        if (cls) {
            span.className = cls;
        }
        this.appendChild(span);
        return span;
    };
}

// Mock the Setting class
jest.mock('obsidian', () => ({
    ...jest.requireActual('obsidian'),
    Setting: jest.fn().mockImplementation(function (containerEl) {
        const settingEl = document.createElement('div');
        containerEl.appendChild(settingEl);

        this.setName = jest.fn().mockImplementation(function (name) {
            const nameEl = document.createElement('div');
            nameEl.textContent = name;
            settingEl.appendChild(nameEl);
            return this;
        });

        this.setDesc = jest.fn().mockImplementation(function (desc) {
            const descEl = document.createElement('div');
            descEl.textContent = desc;
            settingEl.appendChild(descEl);
            return this;
        });

        this.addToggle = jest.fn().mockImplementation(function (cb) {
            cb({
                setValue: jest.fn().mockReturnThis(),
                onChange: jest.fn().mockReturnThis(),
            });
            return this;
        });

        this.addSlider = jest.fn().mockImplementation(function (cb) {
            cb({
                setValue: jest.fn().mockReturnThis(),
                onChange: jest.fn().mockReturnThis(),
                setLimits: jest.fn().mockReturnThis(),
                setDynamicTooltip: jest.fn().mockReturnThis(),
            });
            return this;
        });

        this.addText = jest.fn().mockImplementation(function (cb) {
            cb({
                setValue: jest.fn().mockReturnThis(),
                onChange: jest.fn().mockReturnThis(),
                setPlaceholder: jest.fn().mockReturnThis(),
            });
            return this;
        });

        this.addButton = jest.fn().mockImplementation(function (cb) {
            const buttonEl = document.createElement('button');
            settingEl.appendChild(buttonEl);

            const button = {
                setButtonText: jest.fn().mockImplementation(function (text) {
                    buttonEl.textContent = text;
                    return this;
                }),
                onClick: jest.fn().mockImplementation(function (clickHandler) {
                    buttonEl.addEventListener('click', clickHandler);
                    return this;
                }),
            };
            cb(button);
            return this;
        });

        this.addExtraButton = jest.fn().mockImplementation(function (cb) {
            cb({
                setIcon: jest.fn().mockReturnThis(),
                setTooltip: jest.fn().mockReturnThis(),
                onClick: jest.fn().mockReturnThis(),
            });
            return this;
        });

        this.setClass = jest.fn().mockImplementation(function (className) {
            settingEl.classList.add(className);
            return this;
        });

        this.setDisabled = jest.fn().mockReturnThis();

        this.setValue = jest.fn().mockImplementation(function (value) {
            settingEl.textContent = value;
            return this;
        });

        this.onChange = jest.fn().mockReturnThis();

        return this;
    })
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

describe('SubscriptionSettingsTab', () => {
    let app: App;
    let containerEl: HTMLElement;
    let plugin: KeepSidianPlugin;
    let subscriptionTab: SubscriptionSettingsTab;

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
        app = new App();
        plugin = new KeepSidianPlugin(app, TEST_MANIFEST);
        plugin.settings = {
            email: '',
            token: '',
            saveLocation: '',
            subscriptionCache: undefined,
            premiumFeatures: {
                autoSync: false,
                syncIntervalMinutes: 30,
                updateTitle: false,
                suggestTags: false,
                maxTags: 5,
                tagPrefix: '',
                limitToExistingTags: false,
                includeNotesTerms: [],
                excludeNotesTerms: []
            } as PremiumFeatureSettings
        };
        plugin.subscriptionService = mockSubscriptionService();

        const keepSidianSettingsTab = new KeepSidianSettingsTab(app, plugin);
        containerEl = keepSidianSettingsTab.containerEl;
        subscriptionTab = new SubscriptionSettingsTab(containerEl, plugin);
    });

    describe('display()', () => {
        it('should display premium settings with subscription prompt when subscription is not active', async () => {
            jest.spyOn(plugin.subscriptionService, 'isSubscriptionActive').mockResolvedValue(false);

            await subscriptionTab.display();

            expect(containerEl.querySelector('h4')?.textContent).toBe('Why subscribe?');
            expect(containerEl.textContent).toContain('Auto-tags');
            expect(containerEl.textContent).toContain('requires a subscription');
        });

        it('should display active subscriber view when subscription is active', async () => {
            jest.spyOn(plugin.subscriptionService, 'isSubscriptionActive').mockResolvedValue(true);
            jest.spyOn(plugin.subscriptionService, 'checkSubscription').mockResolvedValue({
                subscription_status: 'active',
                plan_details: { plan_id: 'premium', features: [] },
                metering_info: { usage: 100, limit: 1000 },
                trial_or_promo: null
            });

            await subscriptionTab.display();

            expect(containerEl.textContent).toContain('✅ Active subscription');
            expect(containerEl.textContent).toContain('Auto-tags');
            expect(containerEl.textContent).not.toContain('requires a subscription');
        });
    });

    describe('Premium Features Display', () => {
        it('should display tag suggestion settings for subscribers', async () => {
            jest.spyOn(plugin.subscriptionService, 'isSubscriptionActive').mockResolvedValue(true);
            await subscriptionTab.display();

            expect(containerEl.textContent).toContain('Auto-tags');
            expect(containerEl.textContent).toContain('Maximum tags');
            expect(containerEl.textContent).toContain('Tag prefix');
        });

        it('should display note filtering settings for non-subscribers', async () => {
            jest.spyOn(plugin.subscriptionService, 'isSubscriptionActive').mockResolvedValue(false);
            await subscriptionTab.display();

            expect(containerEl.textContent).toContain('Only include notes containing');
            expect(containerEl.textContent).toContain('Exclude notes containing');
            expect(containerEl.textContent).toContain('requires a subscription');
        });
    });

    describe('Event Handlers', () => {
        beforeEach(() => {
            (plugin.subscriptionService.isSubscriptionActive as jest.Mock).mockResolvedValue(true);
        });

        it('should handle subscription check button click', async () => {
            await subscriptionTab.display();

            // Find and simulate click on refresh button
            const refreshButton = containerEl.querySelector('[aria-label="Check subscription status"]') as HTMLElement;
            refreshButton?.click();

            expect(plugin.subscriptionService.checkSubscription).toHaveBeenCalled();
        });

        it('should handle subscribe button click for inactive users', async () => {
            (plugin.subscriptionService.isSubscriptionActive as jest.Mock).mockResolvedValue(false);
            
            // Mock window.open
            const mockOpen = jest.fn();
            jest.spyOn(window, 'open').mockImplementation(mockOpen);

            await subscriptionTab.display();

            // Find and simulate click on subscribe button
            const subscribeButton = containerEl.querySelector('button');
            subscribeButton?.click();

            expect(mockOpen).toHaveBeenCalledWith('https://keepsidian.com/subscribe', '_blank');
        });
    });
});
