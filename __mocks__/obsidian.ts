// __mocks__/obsidian.ts
export class App {}

export class Plugin {
  app: App;
  manifest: any;

  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  onload() {}
  onunload() {}
  addCommand() {}
  addRibbonIcon() {}
  addSettingTab() {}
  loadData() {}
  saveData() {}
  registerDomEvent() {}
  registerInterval() {}
}

export class Notice {
  constructor(message: string) {}
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;

    // Create a container element and add the empty method
    this.containerEl = document.createElement('div');
    (this.containerEl as any).empty = function() {
      this.innerHTML = '';
    };


    const createElFunction = function(tagName: string, options?: any) {
      const el = document.createElement(tagName);
      if (options?.text) {
        el.textContent = options.text;
      }
      this.appendChild(el);
      (el as any).createEl = createElFunction;
      return el;
    };

    (this.containerEl as any).createEl = createElFunction;
  }
}

export class SubscriptionSettingsTab {
  containerEl: HTMLElement;
  plugin: Plugin;

  constructor(containerEl: HTMLElement, plugin: Plugin) {
    this.containerEl = containerEl;
    this.plugin = plugin;

    // Create a container element and add the empty method
    this.containerEl = document.createElement('div');
    (this.containerEl as any).empty = function() {
      this.innerHTML = '';
    };

    (this.containerEl as any).createEl = function(tagName: string, options?: any) {
      const el = document.createElement(tagName);
      if (options?.text) {
        el.textContent = options.text;
      }
      this.appendChild(el);
      return el;
    };
  }
}


export class Setting {
  constructor(containerEl: HTMLElement) {}
  setName(name: string) { return this; }
  setDesc(desc: string) { return this; }
  setClass(cls: string) { return this; }
  addText(callback: (text: any) => void) { return this; }
  addToggle(callback: (toggle: any) => void) { return this; }
  addButton(callback: (button: any) => void) { return this; }
  addSlider(callback: (slider: any) => void) { return this; }
  addExtraButton(callback: (extraButton: any) => void) { return this; }
  setDisabled(disabled: boolean) { return this; }
  setValue(value: any) { return this; }
  onChange(callback: (value: any) => void) { return this; }
}

export class Modal {
  app: App;
  titleEl: HTMLElement = document.createElement('div');
  contentEl: HTMLElement = document.createElement('div');
  modalEl: HTMLElement = document.createElement('div');

  constructor(app: App) {
    this.app = app;
  }

  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

// Add requestUrl mock
export const requestUrl = jest.fn();