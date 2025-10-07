jest.mock("obsidian");

import { Menu } from "obsidian";
import KeepSidianPlugin from "../../main";
import { initializeStatusBar } from "../../app/sync-ui";
import { DEFAULT_SETTINGS } from "../../types/keepsidian-plugin-settings";

type MenuItemMock = {
	title: string | DocumentFragment;
	icon: string | null;
	disabled: boolean;
	onClickHandler?: (evt: MouseEvent | KeyboardEvent) => any;
};

type MenuMockContainer = {
	items: MenuItemMock[];
};

const MenuMock = Menu as unknown as {
	instances: MenuMockContainer[];
};

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
		MenuMock.instances.length = 0;
		statusBarItem = createStatusBarStub();
		const app = { workspace: {}, vault: {} } as unknown as KeepSidianPlugin["app"];
		plugin = new KeepSidianPlugin(app, TEST_MANIFEST);
		plugin.settings = { ...DEFAULT_SETTINGS };
		plugin.addStatusBarItem = jest.fn().mockReturnValue(statusBarItem);
		initializeStatusBar(plugin);
	});

	function getMenuTitleText(title: string | DocumentFragment): string {
		if (typeof title === "string") {
			return title;
		}
		return title.textContent ?? "";
	}

	function triggerStatusMenu() {
		const handler = (statusBarItem.addEventListener as jest.Mock).mock.calls.find(
			([eventName]) => eventName === "click"
		)?.[1] as (evt: MouseEvent) => void;
		expect(handler).toBeDefined();
		handler(new MouseEvent("click"));
		const menu = MenuMock.instances[MenuMock.instances.length - 1];
		expect(menu).toBeDefined();
		return menu;
	}

	it("shows lock indicators and gating message when safeguards missing", async () => {
		const gateState = {
			allowed: false,
			reasons: ["Confirm backups"],
		};
		jest
			.spyOn(plugin, "getTwoWayGateSnapshot")
			.mockReturnValue(gateState);
		const requireSpy = jest
			.spyOn(plugin, "requireTwoWaySafeguards")
			.mockResolvedValue(gateState);
		const noticeSpy = jest
			.spyOn(plugin, "showTwoWaySafeguardNotice")
			.mockImplementation(() => {});

		const menu = triggerStatusMenu();
		const items = menu.items as MenuItemMock[];

		const twoWayItem = items.find((item: MenuItemMock) =>
			getMenuTitleText(item.title).startsWith("Two-way sync")
		);
		const uploadItem = items.find((item: MenuItemMock) =>
			getMenuTitleText(item.title).startsWith("Upload to Google Keep")
		);
		const openSettingsItem = items.find((item: MenuItemMock) =>
			getMenuTitleText(item.title).startsWith("Open beta settings")
		);

		expect(twoWayItem?.icon).toBe("lock");
		expect(uploadItem?.icon).toBe("lock");
		expect(openSettingsItem).toBeDefined();

		if (twoWayItem?.onClickHandler) {
			await twoWayItem.onClickHandler(new MouseEvent("click"));
		}
		expect(requireSpy).toHaveBeenCalled();
		expect(noticeSpy).toHaveBeenCalled();
	});

	it("runs uploads normally when safeguards satisfied", async () => {
		const gateState = {
			allowed: true,
			reasons: [] as string[],
		};
		jest
			.spyOn(plugin, "getTwoWayGateSnapshot")
			.mockReturnValue(gateState);
		const requireSpy = jest
			.spyOn(plugin, "requireTwoWaySafeguards")
			.mockResolvedValue(gateState);
		const noticeSpy = jest
			.spyOn(plugin, "showTwoWaySafeguardNotice")
			.mockImplementation(() => {});
		const twoWaySpy = jest
			.spyOn(plugin, "performTwoWaySync")
			.mockResolvedValue(undefined);
		const pushSpy = jest
			.spyOn(plugin, "pushNotes")
			.mockResolvedValue(undefined);

		const menu = triggerStatusMenu();
		const items = menu.items as MenuItemMock[];
		const twoWayItem = items.find((item: MenuItemMock) =>
			getMenuTitleText(item.title) === "Two-way sync"
		);
		const uploadItem = items.find((item: MenuItemMock) =>
			getMenuTitleText(item.title) === "Upload to Google Keep"
		);

		expect(twoWayItem?.icon).toBeNull();
		expect(uploadItem?.icon).toBeNull();

		if (twoWayItem?.onClickHandler) {
			await twoWayItem.onClickHandler(new MouseEvent("click"));
		}
		if (uploadItem?.onClickHandler) {
			await uploadItem.onClickHandler(new MouseEvent("click"));
		}

		expect(requireSpy).toHaveBeenCalledTimes(2);
		expect(noticeSpy).not.toHaveBeenCalled();
		expect(twoWaySpy).toHaveBeenCalled();
		expect(pushSpy).toHaveBeenCalled();
	});
});
