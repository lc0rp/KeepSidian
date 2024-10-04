import { Plugin, Notice } from 'obsidian';
import KeepSidianPlugin from '../main';
import { importGoogleKeepNotes } from '../google/keep/import';
import { importGoogleDriveFiles } from '../google/drive/import';
import { KeepSidianSettingTab, DEFAULT_SETTINGS } from '../settings';


jest.mock('obsidian');
jest.mock('../google/keep/import');
jest.mock('../google/drive/import');
jest.mock('../settings');


describe('KeepSidianPlugin', () => {
    let plugin: KeepSidianPlugin;
    let mockApp: jest.Mocked<Plugin['app']>;
    const manifest = { id: 'keepsidian', name: 'KeepSidian', author: 'lc0rp', version: '0.0.1', minAppVersion: '0.0.1', description: 'Import Google Keep notes.' };

    class MockPlugin extends Plugin {
        constructor() {
            super({} as any, manifest);
        }
    }
    
    beforeEach(() => {
        mockApp = new MockPlugin().app as jest.Mocked<Plugin['app']>;
        plugin = new KeepSidianPlugin(mockApp, manifest);
        plugin.loadSettings = jest.fn().mockResolvedValue(undefined);
        plugin.saveSettings = jest.fn().mockResolvedValue(undefined);
    });

    describe('onload', () => {
        it('should load settings and add ribbon icon', async () => {
            const mockAddRibbonIcon = jest.fn().mockReturnValue({ addClass: jest.fn() });
            plugin.addRibbonIcon = mockAddRibbonIcon;

            await plugin.onload();

            expect(plugin.loadSettings).toHaveBeenCalled();
            expect(mockAddRibbonIcon).toHaveBeenCalledWith('folder-sync', 'Import Google Keep notes.', expect.any(Function));
            
            // Test the callback function
            const ribbonIconCallback = mockAddRibbonIcon.mock.calls[0][2];
            ribbonIconCallback({} as MouseEvent);
            expect(importGoogleKeepNotes).toHaveBeenCalledWith(plugin);
            expect(Notice).toHaveBeenCalledWith('Imported Google Keep notes.');
        });

        it('should add commands to sync notes and Google Drive files', async () => {
            const mockAddCommand = jest.fn();
            plugin.addCommand = mockAddCommand;

            await plugin.onload();

            expect(mockAddCommand).toHaveBeenCalledWith({
                id: 'import-google-keep-notes',
                name: 'Import Google Keep notes.',
                callback: expect.any(Function)
            });

            expect(mockAddCommand).toHaveBeenCalledWith({
                id: 'import-gdrive-files',
                name: 'Import Google Drive files',
                callback: expect.any(Function)
            });
        });

        it('should add a settings tab', async () => {
            const mockAddSettingTab = jest.fn();
            plugin.addSettingTab = mockAddSettingTab;

            await plugin.onload();

            expect(mockAddSettingTab).toHaveBeenCalledWith(expect.any(KeepSidianSettingTab));
        });

        it('should handle errors during settings load', async () => {
            plugin.loadSettings = jest.fn().mockRejectedValue(new Error('Load settings failed'));
            const mockAddRibbonIcon = jest.fn().mockReturnValue({ addClass: jest.fn() });
            plugin.addRibbonIcon = mockAddRibbonIcon;

            await expect(plugin.onload()).rejects.toThrow('Load settings failed');
        });
    });

    describe('loadSettings', () => {
        it('should load settings with default values', async () => {
            const mockLoadData = jest.fn().mockResolvedValue({});
            plugin.loadData = mockLoadData;

            await plugin.loadSettings();

            expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
        });

        it('should load settings with saved values', async () => {
            const savedSettings = { token: 'test-token', saveLocation: 'test-location' };
            const mockLoadData = jest.fn().mockResolvedValue(savedSettings);
            plugin.loadData = mockLoadData;

            await plugin.loadSettings();

            expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, ...savedSettings });
        });
    });

    describe('saveSettings', () => {
        it('should save settings', async () => {
            const mockSaveData = jest.fn();
            plugin.saveData = mockSaveData;
            plugin.settings = { ...DEFAULT_SETTINGS, token: 'test-token', saveLocation: 'test-location' };

            await plugin.saveSettings();

            expect(mockSaveData).toHaveBeenCalledWith(plugin.settings);
        });

        it('should handle errors during settings save', async () => {
            plugin.saveData = jest.fn().mockRejectedValue(new Error('Save settings failed'));
            plugin.settings = { ...DEFAULT_SETTINGS, token: 'test-token', saveLocation: 'test-location' };

            await expect(plugin.saveSettings()).rejects.toThrow('Save settings failed');
        });
    });

    describe('commands', () => {
        beforeEach(() => {
            plugin.addCommand = jest.fn();
        });

        it('should call importGoogleKeepNotes when import-google-keep-notes command is executed', async () => {
            await plugin.onload();
            const importGoogleKeepNotesCommand = (plugin.addCommand as jest.Mock).mock.calls.find((call: any) => call[0].id === 'import-google-keep-notes')[0].callback;

            importGoogleKeepNotesCommand();

            expect(importGoogleKeepNotes).toHaveBeenCalledWith(plugin);
        });

        it('should call importGoogleDriveFiles when import-gdrive-files command is executed', async () => {
            await plugin.onload();
            const importGoogleDriveFilesCommand = (plugin.addCommand as jest.Mock).mock.calls.find((call: any) => call[0].id === 'import-gdrive-files')[0].callback;
            
            importGoogleDriveFilesCommand();

            expect(importGoogleDriveFiles).toHaveBeenCalledWith(plugin);
        });
    });
});
