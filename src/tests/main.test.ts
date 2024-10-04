import { Plugin, Notice } from 'obsidian';
import KeepSidianPlugin from '../main';
import { importGoogleKeepNotes } from '../google/keep/import';
import { KeepSidianSettingTab, DEFAULT_SETTINGS } from '../settings';

jest.mock('obsidian');
jest.mock('../google/keep/import');
jest.mock('../settings');

describe('KeepSidianPlugin Tests', () => {
  let plugin: KeepSidianPlugin;
  let mockApp: jest.Mocked<Plugin['app']>;
  const manifest = {
    id: 'keepsidian',
    name: 'KeepSidian',
    author: 'lc0rp',
    version: '0.0.1',
    minAppVersion: '0.0.1',
    description: 'Import Google Keep notes.',
  };

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
    it('should load settings', async () => {
        const loadSettingsSpy = jest.spyOn(plugin, 'loadSettings');
        await plugin.onload();
        expect(loadSettingsSpy).toHaveBeenCalled();
    });

    it('should add ribbon icon with correct callback', async () => {
      const mockAddRibbonIcon = jest.fn().mockReturnValue({ addClass: jest.fn() });
      plugin.addRibbonIcon = mockAddRibbonIcon;

      await plugin.onload();

      expect(mockAddRibbonIcon).toHaveBeenCalledWith(
        'folder-sync',
        'Import Google Keep notes.',
        expect.any(Function)
      );

      // Test the callback function
      const ribbonIconCallback = mockAddRibbonIcon.mock.calls[0][2];
      ribbonIconCallback({} as MouseEvent);
      expect(importGoogleKeepNotes).toHaveBeenCalledWith(plugin);
      expect(Notice).toHaveBeenCalledWith('Imported Google Keep notes.');
    });

    it('should add import Google Keep notes command', async () => {
      const mockAddCommand = jest.fn();
      plugin.addCommand = mockAddCommand;

      await plugin.onload();

      expect(mockAddCommand).toHaveBeenCalledWith({
        id: 'import-google-keep-notes',
        name: 'Import Google Keep notes.',
        callback: expect.any(Function),
      });

      // Test the command callback
      const commandCallback = mockAddCommand.mock.calls[0][0].callback;
      commandCallback();
      expect(importGoogleKeepNotes).toHaveBeenCalledWith(plugin);
    });

    it('should add settings tab', async () => {
      const mockAddSettingTab = jest.fn();
      plugin.addSettingTab = mockAddSettingTab;

      await plugin.onload();

      expect(mockAddSettingTab).toHaveBeenCalledWith(expect.any(KeepSidianSettingTab));
    });
  });

  describe('loadSettings', () => {
    it('should load default settings when no data is saved', async () => {
      plugin.loadData = jest.fn().mockResolvedValue(undefined);

      await plugin.loadSettings();

      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should load saved settings', async () => {
      const savedSettings = { email: 'test@example.com' };
      plugin.loadData = jest.fn().mockResolvedValue(savedSettings);

      await plugin.loadSettings();

      expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, ...savedSettings });
    });
  });

  describe('saveSettings', () => {
    it('should save settings', async () => {
      const mockSaveData = jest.fn();
      plugin.saveData = mockSaveData;
      plugin.settings = { email: 'test@example.com' } as any;

      await plugin.saveSettings();

      expect(mockSaveData).toHaveBeenCalledWith(plugin.settings);
    });
  });
});
