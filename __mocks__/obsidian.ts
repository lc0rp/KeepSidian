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
  addStatusBarItem() {
    const el = document.createElement('div') as any;
    el.setText = function(text: string) { this.textContent = text; };
    return el;
  }
}

export const Notice = jest.fn().mockImplementation(function (this: any, message: string, timeout?: number) {
  this.message = message;
  this.timeout = timeout;
});
Notice.prototype.setMessage = function(message: string) { this.message = message; };
Notice.prototype.hide = function() {};

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
      if (options?.cls) {
        if (Array.isArray(options.cls)) {
          el.classList.add(...options.cls);
        } else if (typeof options.cls === 'string') {
          el.classList.add(options.cls);
        }
      }
      if (options?.attr) {
        Object.entries(options.attr).forEach(([key, value]) => {
          el.setAttribute(key, String(value));
        });
      }
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

export function setIcon(element: HTMLElement, icon: string): void {
  element.setAttribute('data-icon', icon);
}

// Minimal normalizePath mock to mirror Obsidian API behavior in tests
export function normalizePath(p: string): string {
  if (!p) return '';
  // Replace backslashes and collapse duplicate slashes
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
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
      if (options?.cls) {
        if (Array.isArray(options.cls)) {
          el.classList.add(...options.cls);
        } else if (typeof options.cls === 'string') {
          el.classList.add(options.cls);
        }
      }
      if (options?.attr) {
        Object.entries(options.attr).forEach(([key, value]) => {
          el.setAttribute(key, String(value));
        });
      }
      if (options?.text) {
        el.textContent = options.text;
      }
      this.appendChild(el);
      (el as any).createEl = (this as any).createEl;
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
  contentEl: HTMLElement;
  modalEl: HTMLElement = document.createElement('div');

  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement('div');
    (this.contentEl as any).empty = function() { this.innerHTML = ''; };
    (this.contentEl as any).createEl = function(tagName: string, options?: any) {
      const el = document.createElement(tagName);
      if (options?.text) { el.textContent = options.text; }
      this.appendChild(el);
      return el;
    };
  }

  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

// Add requestUrl mock
export const requestUrl = jest.fn();

class MenuItemMock {
  title = '';
  disabled = false;
  onClickCallback?: () => void;

  setTitle(title: string) {
    this.title = title;
    return this;
  }

  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    return this;
  }

  onClick(callback: () => void) {
    this.onClickCallback = callback;
    return this;
  }

  setIcon() {
    return this;
  }
}

export class Menu {
  items: Array<{ title: string; disabled: boolean; onClick?: () => void }> = [];

  addItem(callback: (item: MenuItemMock) => void) {
    const item = new MenuItemMock();
    callback(item);
    this.items.push({
      title: item.title,
      disabled: item.disabled,
      onClick: item.onClickCallback,
    });
    return this;
  }

  addSeparator() {
    return this;
  }

  showAtMouseEvent() {}

  showAtPosition() {}
}
