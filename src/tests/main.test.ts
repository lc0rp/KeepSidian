jest.mock('obsidian');
jest.mock('../components/NoteImportOptionsModal', () => ({
    NoteImportOptionsModal: jest.fn().mockImplementation(() => ({
        open: jest.fn()
    }))
}));

import { Plugin, Notice } from 'obsidian';
import KeepSidianPlugin from '../main';
import * as ImportModule from '../google/keep/import';
import { DEFAULT_SETTINGS } from '../types/keepsidian-plugin-settings';
import { KeepSidianSettingsTab } from '../components/KeepSidianSettingsTab';
import { SubscriptionService } from '../services/subscription';
import { NoteImportOptionsModal } from '../components/NoteImportOptionsModal';

describe('KeepSidianPlugin', () => {
    let plugin: KeepSidianPlugin;
    let mockApp: jest.Mocked<Plugin['app']>;

    const TEST_MANIFEST = {
        id: 'keepsidian',
        name: 'KeepSidian',
        author: 'lc0rp',
        version: '0.0.1',
        minAppVersion: '0.0.1',
        description: 'Import Google Keep notes.',
    };

    beforeEach(() => {
        jest.clearAllMocks();

        mockApp = {
            workspace: {},
            vault: {}
        } as any;

        plugin = new KeepSidianPlugin(mockApp, TEST_MANIFEST);

        plugin.loadData = jest.fn().mockResolvedValue({});
        plugin.saveData = jest.fn().mockResolvedValue(undefined);
        plugin.addRibbonIcon = jest.fn();
        plugin.addCommand = jest.fn();
        plugin.addSettingTab = jest.fn();
        plugin.registerInterval = jest.fn();

        const mockSubscriptionService = {
            isSubscriptionActive: jest.fn().mockResolvedValue(false),
            checkSubscription: jest.fn().mockResolvedValue(null)
        } as unknown as SubscriptionService;

        plugin.subscriptionService = mockSubscriptionService;
    });

    describe('onload', () => {
        it('should initialize plugin with default settings', async () => {
            await plugin.onload();

            expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
            expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
                'folder-sync',
                'Import Google Keep notes.',
                expect.any(Function)
            );
            expect(plugin.addCommand).toHaveBeenCalledWith({
                id: 'import-google-keep-notes',
                name: 'Import Google Keep Notes',
                callback: expect.any(Function)
            });
            expect(plugin.addSettingTab).toHaveBeenCalledWith(expect.any(KeepSidianSettingsTab));
        });
    });

    describe('importNotes', () => {
        it('should use basic import for non-premium users', async () => {
            plugin.subscriptionService.isSubscriptionActive = jest.fn().mockResolvedValue(false);
            const importMock = jest.spyOn(ImportModule, 'importGoogleKeepNotes').mockResolvedValue(0);

            await plugin.onload();
            const ribbonClickHandler = (plugin.addRibbonIcon as jest.Mock).mock.calls[0][2];

            await ribbonClickHandler({} as MouseEvent);
            await new Promise(process.nextTick);

            expect(importMock).toHaveBeenCalled();
            expect(importMock).toHaveBeenCalledWith(plugin);
            expect(NoteImportOptionsModal).not.toHaveBeenCalled();
        });

        it('should show options modal for premium users', async () => {
            await plugin.onload(); // Initialize the plugin and subscriptionService

            // Spy on isSubscriptionActive after subscriptionService is initialized
            const isSubscriptionActiveSpy = jest
                .spyOn(plugin.subscriptionService, 'isSubscriptionActive')
                .mockResolvedValue(true);

            const importMock = jest
                .spyOn(ImportModule, 'importGoogleKeepNotes')
                .mockResolvedValue(0);

            // Create spy for showImportOptionsModal
            const showModalSpy = jest
                .spyOn(plugin, 'showImportOptionsModal')
                .mockImplementation(async () => { });

            await new Promise((resolve) => setTimeout(resolve, 0));

            const ribbonClickHandler = (plugin.addRibbonIcon as jest.Mock).mock.calls[0][2];
            await ribbonClickHandler({} as MouseEvent);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(isSubscriptionActiveSpy).toHaveBeenCalled(); // Now Jest recognizes the spy
            expect(showModalSpy).toHaveBeenCalled();
            expect(importMock).not.toHaveBeenCalled();

            // Clean up
            showModalSpy.mockRestore();
            isSubscriptionActiveSpy.mockRestore();
            importMock.mockRestore();
        });
    });

    describe('auto sync', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should start auto sync when enabled', async () => {
            plugin.loadData = jest.fn().mockResolvedValue({ autoSyncEnabled: true, autoSyncIntervalHours: 1 });
            const importSpy = jest.spyOn(plugin, 'importNotes').mockResolvedValue();
            await plugin.onload();
            jest.advanceTimersByTime(60 * 60 * 1000);
            expect(importSpy).toHaveBeenCalledWith(true);
        });

        it('should log sync results to file', async () => {
            plugin.subscriptionService.isSubscriptionActive = jest.fn().mockResolvedValue(false);
            plugin.settings = { ...DEFAULT_SETTINGS };
            plugin.app = {
                vault: {
                    adapter: {
                        exists: jest.fn().mockResolvedValue(false),
                        read: jest.fn().mockResolvedValue(''),
                        write: jest.fn().mockResolvedValue(undefined)
                    }
                }
            } as any;
            const importMock = jest.spyOn(ImportModule, 'importGoogleKeepNotes').mockResolvedValue(0);
            (require('obsidian') as any).normalizePath = (p: string) => p;
            await plugin.importNotes();
            expect(plugin.app.vault.adapter.write).toHaveBeenCalled();
            importMock.mockRestore();
        });
    });

    describe('settings', () => {
        it('should load and merge settings with defaults', async () => {
            const savedSettings = { email: 'test@example.com' };
            plugin.loadData = jest.fn().mockResolvedValue(savedSettings);

            await plugin.loadSettings();

            expect(plugin.settings).toEqual({
                ...DEFAULT_SETTINGS,
                ...savedSettings
            });
        });

        it('should save settings', async () => {
            const testSettings = { ...DEFAULT_SETTINGS, email: 'test@example.com' };
            plugin.settings = testSettings;

            await plugin.saveSettings();

            expect(plugin.saveData).toHaveBeenCalledWith(testSettings);
        });
    });
});
