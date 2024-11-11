import { initRetrieveToken, exchangeOauthToken } from '../token';
import { WebviewTag } from 'electron';
import * as obsidian from 'obsidian';
import KeepSidianPlugin from 'main';
import { KeepSidianSettingsTab } from '../../../components/KeepSidianSettingsTab';

// Mock obsidian
jest.mock('obsidian', () => ({
    ...jest.requireActual('obsidian'),
    requestUrl: jest.fn(),
    Notice: jest.fn()
}));

// Mock the main plugin
jest.mock('main');

describe('Token Management', () => {
    let plugin: jest.Mocked<KeepSidianPlugin>;
    let settingsTab: jest.Mocked<KeepSidianSettingsTab>;
    let retrieveTokenWebview: jest.Mocked<WebviewTag>;

    beforeEach(() => {
        jest.clearAllMocks();

        plugin = {
            settings: {
                email: 'test@example.com',
                token: '',
            },
            saveSettings: jest.fn().mockResolvedValue(undefined),
        } as unknown as jest.Mocked<KeepSidianPlugin>;

        settingsTab = {
            display: jest.fn(),
        } as unknown as jest.Mocked<KeepSidianSettingsTab>;

        retrieveTokenWebview = {
            loadURL: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            getURL: jest.fn(),
            executeJavaScript: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            openDevTools: jest.fn(),
            closeDevTools: jest.fn(),
        } as unknown as jest.Mocked<WebviewTag>;
    });

    describe('exchangeOauthToken', () => {
        beforeEach(() => {
            (obsidian.requestUrl as jest.Mock).mockReset();
        });

        it('should successfully exchange OAuth token', async () => {
            const mockKeepToken = 'mock-keep-token';
            const mockOAuthToken = 'mock-oauth-token';

            (obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
                status: 200,
                json: {
                    keep_token: mockKeepToken,
                },
            });

            await exchangeOauthToken(settingsTab, plugin, mockOAuthToken);

            expect(plugin.settings.token).toBe(mockKeepToken);
            expect(plugin.saveSettings).toHaveBeenCalled();
            expect(settingsTab.display).toHaveBeenCalled();
        });

        it('should handle server errors', async () => {
            (obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
                status: 500,
                json: {},
            });

            await expect(exchangeOauthToken(
                settingsTab,
                plugin,
                'mock-oauth-token'
            )).rejects.toThrow('Server returned status 500');

            expect(obsidian.Notice).toHaveBeenCalledWith(
                expect.stringContaining('Failed to exchange OAuth token')
            );
        });

        it('should handle invalid response format', async () => {
            (obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
                status: 200,
                json: {
                    some_other_field: 'value',
                },
            });

            await expect(exchangeOauthToken(
                settingsTab,
                plugin,
                'mock-oauth-token'
            )).rejects.toThrow('Failed to parse server response: Error: Invalid response format');
        });
    });

    describe('initRetrieveToken', () => {
        it('should handle successful token retrieval', async () => {
            const mockOAuthToken = 'mock-oauth-token';
        
            // Mock getURL to return the desired URL every time it's called
            retrieveTokenWebview.getURL.mockReturnValue('accounts.google.com');
        
            // Mock executeJavaScript to resolve immediately
            retrieveTokenWebview.executeJavaScript.mockResolvedValue(undefined);
        
            // Mock setInterval to immediately invoke the callback
            jest.spyOn(global, 'setInterval').mockImplementation((callback: any, ms: number) => {
                // Immediately call the callback
                callback();
                // Return a mock interval ID
                return 1 as any;
            });
        
            // Mock the 'console-message' event to simulate token retrieval
            retrieveTokenWebview.addEventListener.mockImplementation((event: string, handler: any) => {
                if (event === 'console-message') {
                    handler({
                        message: `oauthToken: ${mockOAuthToken}`,
                        level: 0,
                        line: 1,
                        sourceId: 'test',
                    });
                }
            });
        
            // Mock the requestUrl function
            (obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
                status: 200,
                json: {
                    keep_token: 'mock-keep-token',
                },
            });
        
            // Start the token retrieval process
            await initRetrieveToken(settingsTab, plugin, retrieveTokenWebview);
        
            // Assertions
            expect(retrieveTokenWebview.loadURL).toHaveBeenCalled();
            expect(retrieveTokenWebview.show).toHaveBeenCalled();
            expect(retrieveTokenWebview.executeJavaScript).toHaveBeenCalled();
        });

        it('should handle errors during token retrieval', async () => {
            const error = new Error('Failed to retrieve token');
            retrieveTokenWebview.loadURL.mockRejectedValue(error);

            await expect(initRetrieveToken(
                settingsTab,
                plugin,
                retrieveTokenWebview
            )).rejects.toThrow('Failed to retrieve token');

            expect(obsidian.Notice).toHaveBeenCalledWith(
                expect.stringContaining('Failed to retrieve token')
            );
        });
    });
}); 