/**
 * @jest-environment jsdom
 */
import { App, PluginSettingTab, Notice } from 'obsidian';
import { KeepSidianSettingsTab } from '../KeepSidianSettingsTab';
import KeepSidianPlugin from '../../main';
import { SubscriptionService } from 'services/subscription';
import { initRetrieveToken } from '../../google/keep/token';

jest.mock('../NoteImportOptionsModal', () => ({
    NoteImportOptionsModal: jest.fn().mockImplementation(() => ({
        open: jest.fn()
    }))
}));

jest.mock('../../google/keep/token', () => ({
    exchangeOauthToken: jest.fn(),
    initRetrieveToken: jest.fn(),
}));

// Mock obsidian
jest.mock('obsidian', () => ({
    ...jest.requireActual('obsidian'),
    requestUrl: jest.fn(),
    Notice: jest.fn()
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
    });

    test('should instantiate correctly', () => {
        expect(settingsTab).toBeInstanceOf(PluginSettingTab);
    });

    test('should display settings correctly', async () => {
        const spyAddEmailSetting = jest.spyOn<any, any>(settingsTab, 'addEmailSetting');
        const spyAddSyncTokenSetting = jest.spyOn<any, any>(settingsTab, 'addSyncTokenSetting');
        const spyAddSaveLocationSetting = jest.spyOn<any, any>(settingsTab, 'addSaveLocationSetting');
        const spyAddSubscriptionSettings = jest.spyOn<any, any>(settingsTab, 'addSubscriptionSettings');
        const spyCreateRetrieveTokenWebView = jest.spyOn<any, any>(settingsTab, 'createRetrieveTokenWebView');

        await settingsTab.display();

        expect(spyAddEmailSetting).toHaveBeenCalled();
        expect(spyAddSyncTokenSetting).toHaveBeenCalled();
        expect(spyAddSaveLocationSetting).toHaveBeenCalled();
        expect(spyAddSubscriptionSettings).toHaveBeenCalled();
        expect(spyCreateRetrieveTokenWebView).toHaveBeenCalled();
    });

    test('should validate email properly', () => {
        expect((settingsTab as any).isValidEmail('test@example.com')).toBe(true);
        expect((settingsTab as any).isValidEmail('invalid-email')).toBe(false);
    });

    test('should handle token paste with valid token', async () => {
        const event = {
            preventDefault: jest.fn(),
            clipboardData: {
                getData: jest.fn().mockReturnValue('oauth2_4/token_value'),
            },
        } as unknown as ClipboardEvent;

        // Remove the mock of exchangeOauthToken
        // Instead, mock requestUrl

        // Mock requestUrl from obsidian
        const mockRequestUrl = jest.fn().mockResolvedValue({
            json: async () => ({
                // Mock response data
                accessToken: 'mock_access_token',
                refreshToken: 'mock_refresh_token',
            }),
            status: 200,
        });

        // Mock obsidian module to return mockRequestUrl
        jest.mock('obsidian', () => ({
            ...jest.requireActual('obsidian'),
            requestUrl: mockRequestUrl,
        }));

        await (settingsTab as any).handleTokenPaste(event);

        expect(event.preventDefault).toHaveBeenCalled();
        //expect(mockRequestUrl).toHaveBeenCalled();
    });

    test('should not handle token paste with invalid token', async () => {
        const event = {
            preventDefault: jest.fn(),
            clipboardData: {
                getData: jest.fn().mockReturnValue('invalid_token'),
            },
        } as unknown as ClipboardEvent;

        const exchangeOauthTokenMock = jest.fn();
        jest.mock('../../google/keep/token', () => ({
            exchangeOauthToken: exchangeOauthTokenMock,
            initRetrieveToken: jest.fn(),
        }));

        await (settingsTab as any).handleTokenPaste(event);

        expect(event.preventDefault).toHaveBeenCalled();
        expect(exchangeOauthTokenMock).not.toHaveBeenCalled();
    });

    test('should handle retrieve token with valid email', async () => {
        plugin.settings.email = 'test@example.com';
        const initRetrieveTokenMock = initRetrieveToken as jest.Mock;

        const newNoticeMock = jest.fn();
        (Notice as jest.Mock) = jest.fn(() => newNoticeMock);

        await (settingsTab as any).handleRetrieveToken();

        expect(initRetrieveTokenMock).toHaveBeenCalled();
        expect(newNoticeMock).not.toHaveBeenCalled();
    });

    test('should show notice when retrieving token without valid email', async () => {
        plugin.settings.email = '';

        const noticeMock = jest.fn();
        (Notice as jest.Mock).mockImplementation(noticeMock);

        await (settingsTab as any).handleRetrieveToken();

        expect(noticeMock).toHaveBeenCalledWith('Please enter a valid email address before retrieving the token.');
    });
});
