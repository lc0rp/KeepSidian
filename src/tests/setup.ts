import '@testing-library/jest-dom';

// Mock the Setting class from Obsidian
class MockSetting {
    containerEl: HTMLElement;
    
    constructor(containerEl: HTMLElement) {
        this.containerEl = containerEl;
    }

    setName(_name: string) { return this; }
    setDesc(_desc: string) { return this; }

    addText(cb: (text: Record<string, unknown>) => void) {
        cb({});
        return this;
    }

    addButton(cb: (button: Record<string, unknown>) => void) {
        cb({});
        return this;
    }

    addExtraButton(cb: (button: Record<string, unknown>) => void) {
        cb({});
        return this;
    }
}

// Define our mock WebviewTag element
class MockWebviewElement extends HTMLElement {
    src = '';
    setAttribute(name: string, value: string): void {}
    hide(): void {}

    // Override addEventListener to return 'this' for method chaining
    addEventListener<K extends keyof HTMLElementEventMap>(
        type: K,
        listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions
    ): this;
    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ): this {
        super.addEventListener(type, listener, options);
        return this;
    }
}

// Register the custom element
if (!customElements.get('mock-webview')) {
    customElements.define('mock-webview', MockWebviewElement);
}

// Type declaration to extend HTMLElementTagNameMap
declare global {
    interface HTMLElementTagNameMap {
        'webview': MockWebviewElement;
        'mock-webview': MockWebviewElement;
    }
}

// Create a type-safe createElement mock
const originalCreateElement = document.createElement;
document.createElement = function createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    options?: ElementCreationOptions
): HTMLElementTagNameMap[K] {
    if (tagName === 'webview') {
        return originalCreateElement.call(document, 'mock-webview', options) as HTMLElementTagNameMap[K];
    }
    return originalCreateElement.call(document, tagName, options);
};

jest.mock('obsidian', () => ({
    App: jest.fn(),
    Notice: jest.fn(),
    Plugin: jest.fn(),
    PluginSettingTab: jest.fn(),
    Setting: MockSetting
}));

// Mock electron WebviewTag
jest.mock('electron', () => ({
    WebviewTag: MockWebviewElement
})); 
