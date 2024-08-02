// import { jest } from '@jest/globals';
import { App, PluginManifest } from 'obsidian';
import KeepToObsidianPlugin from '../main';

// Mock Obsidian API
jest.mock('obsidian');

// Mock node-fetch
jest.mock('node-fetch');

describe('KeepToObsidianPlugin', () => {
  let plugin: KeepToObsidianPlugin;
  let mockApp: jest.Mocked<App>;
  const manifest: PluginManifest = { id: 'keepsidian', name: 'KeepSidian', author: 'lc0rp', version: '0.0.1', minAppVersion: '0.0.1', description: 'Import Google Keep notes.' }

  beforeEach(() => {
    mockApp = new App() as jest.Mocked<App>;
    plugin = new KeepToObsidianPlugin(mockApp, manifest);
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
    });
  });

  describe('syncNotes', () => {
    it('should import notes successfully', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ notes: [] }),
      } as any);

      plugin.settings = { token: 'test-token', saveLocation: 'test-location', email: 'test@example.com' };
      plugin.app.vault = {
        adapter: {
          exists: jest.fn().mockResolvedValue(true),
          createFolder: jest.fn().mockResolvedValue(undefined),
        },
      } as any;

      await plugin.syncNotes();

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/sync'), expect.any(Object));
    });

    it('should handle import failure', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as any);

      await plugin.syncNotes();

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/sync'), expect.any(Object));
    });
  });

  describe('retrieveToken', () => {
    it('should retrieve token successfully', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ keep_token: 'new-token' }),
      } as any);

      plugin.getOAuthToken = jest.fn().mockResolvedValue('oauth-token');
      plugin.settings = { email: 'test@example.com', token: '', saveLocation: '' };

      await plugin.retrieveToken();

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/register'), expect.any(Object));
      expect(plugin.settings.token).toBe('new-token');
      expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it('should handle token retrieval failure', async () => {
      const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as any);

      plugin.getOAuthToken = jest.fn().mockResolvedValue('oauth-token');
      plugin.settings = { email: 'test@example.com', token: '', saveLocation: '' };

      await expect(plugin.retrieveToken()).rejects.toThrow('Failed to retrieve token.');
    });
  });
});
