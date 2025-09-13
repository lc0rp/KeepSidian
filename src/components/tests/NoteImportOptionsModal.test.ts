/**
 * @jest-environment jsdom
 */
import { App } from 'obsidian';
import KeepSidianPlugin from '../../main';
import { NoteImportOptionsModal } from '../NoteImportOptionsModal';
import { DEFAULT_SETTINGS } from '../../types/keepsidian-plugin-settings';

// Mock SubscriptionSettingsTab static method used by the modal
jest.mock('../SubscriptionSettingsTab', () => ({
  SubscriptionSettingsTab: {
    displayPremiumFeaturesServer: jest.fn((contentEl: HTMLElement, _plugin: any, premium: any) => {
      // Simulate that UI mutates some premium values prior to submit
      premium.includeNotesTerms = ['foo'];
    })
  }
}));

// DOM-driven Setting mock we can click
jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  const createEl = function(this: HTMLElement, tag: string, opts?: any) {
    const el = document.createElement(tag);
    if (opts?.text) el.textContent = opts.text;
    this.appendChild(el);
    (el as any).createEl = createEl;
    return el;
  };
  class Setting {
    settingEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
      this.settingEl = document.createElement('div');
      (this.settingEl as any).createEl = createEl;
      containerEl.appendChild(this.settingEl);
    }
    setName(name: string) { this.settingEl.createEl('div', { text: name }); return this; }
    setDesc(desc: string) { this.settingEl.createEl('div', { text: String(desc) }); return this; }
    addButton(cb: (btn: any) => void) {
      const btnEl = document.createElement('button');
      this.settingEl.appendChild(btnEl);
      const btn = {
        setButtonText: jest.fn((t: string) => { btnEl.textContent = t; return btn; }),
        setCta: jest.fn(() => btn),
        onClick: jest.fn((fn: () => void) => { btnEl.addEventListener('click', fn); return btn; })
      } as any;
      cb(btn);
      return this;
    }
    addExtraButton(cb: (extra: any) => void) {
      const btnEl = document.createElement('button');
      this.settingEl.appendChild(btnEl);
      const extra = {
        setIcon: jest.fn(() => extra),
        setTooltip: jest.fn(() => extra),
        onClick: jest.fn(() => extra)
      } as any;
      cb(extra);
      return this;
    }
  }
  class Modal extends actual.Modal {}
  class PluginSettingTab extends actual.PluginSettingTab {}
  class App extends actual.App {}
  return { ...actual, Setting, Modal, PluginSettingTab, App };
});

describe('NoteImportOptionsModal', () => {
  let app: App;
  let plugin: KeepSidianPlugin;
  const TEST_MANIFEST = { id: 'keepsidian', name: 'KeepSidian', author: 'lc0rp', version: '0.0.1', minAppVersion: '0.0.1', description: 'Import Google Keep notes.' };

  beforeEach(() => {
    jest.clearAllMocks();
    app = new App();
    plugin = new KeepSidianPlugin(app, TEST_MANIFEST);
    plugin.settings = { ...DEFAULT_SETTINGS };
  });

  test('renders, calls displayPremiumFeaturesServer, and submits options', async () => {
    const onSubmit = jest.fn();
    const modal = new NoteImportOptionsModal(app, plugin, onSubmit);
    // Spy on close to ensure it is called
    const closeSpy = jest.spyOn(modal, 'close').mockImplementation(() => {});

    await modal.onOpen();

    expect(modal.contentEl.textContent).toContain('Import Options');
    const { SubscriptionSettingsTab } = await import('../SubscriptionSettingsTab');
    expect(SubscriptionSettingsTab.displayPremiumFeaturesServer).toHaveBeenCalled();

    // Click the Import button
    const importBtn = Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Import') as HTMLButtonElement;
    expect(importBtn).toBeTruthy();
    importBtn.click();

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ includeNotesTerms: ['foo'] }));
    expect(closeSpy).toHaveBeenCalled();
  });

  test('cancel button closes modal', async () => {
    const modal = new NoteImportOptionsModal(app, plugin, jest.fn());
    const closeSpy = jest.spyOn(modal, 'close').mockImplementation(() => {});
    await modal.onOpen();

    const cancelBtn = Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Cancel') as HTMLButtonElement;
    expect(cancelBtn).toBeTruthy();
    cancelBtn.click();
    expect(closeSpy).toHaveBeenCalled();
  });

  test('onClose empties content', () => {
    const modal = new NoteImportOptionsModal(app, plugin, jest.fn());
    modal.contentEl.createEl('div', { text: 'to be removed' });
    modal.onClose();
    expect(modal.contentEl.innerHTML).toBe('');
  });
});
