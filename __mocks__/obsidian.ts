export const App = jest.fn();
export const Plugin = jest.fn(
    () => ({
        onload: jest.fn(),
        onunload: jest.fn(),
    addCommand: jest.fn(),
    addRibbonIcon: jest.fn(),
    addSettingTab: jest.fn(),
    loadData: jest.fn(),
    saveData: jest.fn(),
    registerDomEvent: jest.fn(),
    registerInterval: jest.fn(),
    })
);
export const Notice = jest.fn();
export const PluginSettingTab = jest.fn();
export const Setting = jest.fn();