jest.mock("obsidian");

import KeepSidianPlugin from "../../main";
import { initializeStatusBar } from "../../app/sync-ui";
import { DEFAULT_SETTINGS } from "../../types/keepsidian-plugin-settings";

const TEST_MANIFEST = {
	id: "keepsidian",
	name: "KeepSidian",
	author: "lc0rp",
	version: "0.0.1",
	minAppVersion: "0.0.1",
	description: "Import Google Keep notes.",
};

type StatusBarStub = HTMLElement & {
	setAttribute: jest.Mock;
	addEventListener: jest.Mock;
	createEl: jest.Mock;
};

function createStatusBarStub(): StatusBarStub {
	const element = document.createElement("div");
	const stub = element as unknown as StatusBarStub;
	stub.setAttribute = jest.fn();
	stub.addEventListener = jest.fn();
	stub.createEl = jest.fn(<K extends keyof HTMLElementTagNameMap>(tag: K) => {
		const child = document.createElement(tag);
		stub.appendChild(child);
		return child;
	});
	return stub;
}

describe("status bar gating", () => {
	let plugin: KeepSidianPlugin;
	let statusBarItem: StatusBarStub;

	beforeEach(() => {
		statusBarItem = createStatusBarStub();
		const app = { workspace: {}, vault: {} } as unknown as KeepSidianPlugin["app"];
		plugin = new KeepSidianPlugin(app, TEST_MANIFEST);
		plugin.settings = { ...DEFAULT_SETTINGS };
		plugin.addStatusBarItem = jest.fn().mockReturnValue(statusBarItem);
		initializeStatusBar(plugin);
	});

	it("opens the sync center when the status bar is clicked", () => {
		const openSyncCenterSpy = jest
			.spyOn(plugin, "openSyncCenter")
			.mockImplementation(() => {});
		const handler = (statusBarItem.addEventListener as jest.Mock).mock.calls.find(
			([eventName]) => eventName === "click"
		)?.[1] as (evt: MouseEvent) => void;

		expect(handler).toBeDefined();
		handler(new MouseEvent("click"));

		expect(openSyncCenterSpy).toHaveBeenCalledTimes(1);
		openSyncCenterSpy.mockRestore();
	});
});
