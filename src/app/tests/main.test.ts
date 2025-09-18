jest.mock("obsidian");
jest.mock("../../ui/modals/NoteImportOptionsModal", () => ({
	NoteImportOptionsModal: jest.fn().mockImplementation(() => ({
		open: jest.fn(),
	})),
}));

import { Plugin, Notice } from "obsidian";
import * as Obsidian from "obsidian";
import KeepSidianPlugin from "../../main";
import * as SyncModule from "../../features/keep/sync";
import { DEFAULT_SETTINGS } from "../../types/keepsidian-plugin-settings";
import { SubscriptionService } from "../../services/subscription";
import { NoteImportOptionsModal } from "../../ui/modals/NoteImportOptionsModal";
import { KeepSidianSettingsTab } from "../../ui/settings/KeepSidianSettingsTab";

describe("KeepSidianPlugin", () => {
	let plugin: KeepSidianPlugin;
	let mockApp: jest.Mocked<Plugin["app"]>;

	const TEST_MANIFEST = {
		id: "keepsidian",
		name: "KeepSidian",
		author: "lc0rp",
		version: "0.0.1",
		minAppVersion: "0.0.1",
		description: "Import Google Keep notes.",
	};

	beforeEach(() => {
		jest.clearAllMocks();

		mockApp = {
			workspace: {},
			vault: {},
		} as any;

		plugin = new KeepSidianPlugin(mockApp, TEST_MANIFEST);

		plugin.loadData = jest.fn().mockResolvedValue({});
		plugin.saveData = jest.fn().mockResolvedValue(undefined);
		plugin.addRibbonIcon = jest.fn();
		plugin.addCommand = jest.fn();
		plugin.addSettingTab = jest.fn();
		plugin.addStatusBarItem = jest.fn(
			() =>
				({
					setText: jest.fn(),
					addEventListener: jest.fn(),
					setAttribute: jest.fn(),
				} as any)
		);

		const mockSubscriptionService = {
			isSubscriptionActive: jest.fn().mockResolvedValue(false),
			checkSubscription: jest.fn().mockResolvedValue(null),
		} as unknown as SubscriptionService;

		plugin.subscriptionService = mockSubscriptionService;
	});

	describe("onload", () => {
		it("should initialize plugin with default settings", async () => {
			await plugin.onload();

			expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
			expect(plugin.addRibbonIcon).toHaveBeenCalledWith(
				"folder-sync",
				"Import Google Keep notes.",
				expect.any(Function)
			);
			expect(plugin.addCommand).toHaveBeenCalledWith({
				id: "import-google-keep-notes",
				name: "Import Google Keep Notes",
				callback: expect.any(Function),
			});
			expect(plugin.addSettingTab).toHaveBeenCalledWith(
				expect.any(KeepSidianSettingsTab)
			);
		});
	});

	describe("importNotes", () => {
		it("should use basic import for non-premium users", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			const importMock = jest
				.spyOn(SyncModule, "importGoogleKeepNotes")
				.mockResolvedValue(0);

			// Provide minimal vault adapter to allow precondition checks
			plugin.app = {
				workspace: {},
				vault: {
					adapter: {
						exists: jest.fn().mockResolvedValue(true),
						read: jest.fn().mockResolvedValue(""),
						write: jest.fn().mockResolvedValue(undefined),
					},
					createFolder: jest.fn().mockResolvedValue(undefined),
				},
			} as any;

			await plugin.onload();

			await plugin.importNotes();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(importMock).toHaveBeenCalled();
			expect(importMock).toHaveBeenCalledWith(
				plugin,
				expect.objectContaining({
					setTotalNotes: expect.any(Function),
					reportProgress: expect.any(Function),
				})
			);
			expect(NoteImportOptionsModal).not.toHaveBeenCalled();
			expect(Notice).toHaveBeenCalledWith(
				"Syncing Google Keep Notes...",
				0
			);
			expect(plugin.progressNotice).not.toBeNull();
			const statusEl = (plugin.addStatusBarItem as jest.Mock).mock
				.results[0].value;
			expect(statusEl.setAttribute).toHaveBeenCalledWith(
				"aria-label",
				"KeepSidian sync progress"
			);
			expect(statusEl.setAttribute).toHaveBeenCalledWith(
				"title",
				"KeepSidian sync progress"
			);
		});

		it("should show options modal for premium users", async () => {
			await plugin.onload(); // Initialize the plugin and subscriptionService

			const isSubscriptionActiveSpy = jest
				.spyOn(plugin.subscriptionService, "isSubscriptionActive")
				.mockResolvedValue(true);

			const importMock = jest
				.spyOn(SyncModule, "importGoogleKeepNotes")
				.mockResolvedValue(0);

			const showModalSpy = jest
				.spyOn(plugin, "showImportOptionsModal")
				.mockImplementation(async () => {});

			await plugin.importNotes();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(isSubscriptionActiveSpy).toHaveBeenCalled();
			expect(showModalSpy).toHaveBeenCalled();
			expect(importMock).not.toHaveBeenCalled();

			showModalSpy.mockRestore();
			isSubscriptionActiveSpy.mockRestore();
			importMock.mockRestore();
		});
	});

	describe("auto sync", () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it("should start auto sync when enabled", async () => {
			plugin.loadData = jest.fn().mockResolvedValue({
				autoSyncEnabled: true,
				autoSyncIntervalHours: 1,
			});
			const importSpy = jest
				.spyOn(plugin, "importNotes")
				.mockResolvedValue();
			await plugin.onload();
			jest.advanceTimersByTime(60 * 60 * 1000);
			expect(importSpy).toHaveBeenCalledWith(true);
		});

		it("should log sync results to file", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			plugin.app = {
				vault: {
					adapter: {
						exists: jest.fn().mockResolvedValue(true),
						read: jest.fn().mockResolvedValue(""),
						write: jest.fn().mockResolvedValue(undefined),
					},
				},
			} as any;
			const importMock = jest
				.spyOn(SyncModule, "importGoogleKeepNotes")
				.mockResolvedValue(0);
			const previousNormalizePath = (
				Obsidian as { normalizePath?: (path: string) => string }
			).normalizePath;
			(
				Obsidian as { normalizePath: (path: string) => string }
			).normalizePath = (p: string) => p;
			await plugin.importNotes();
			expect(plugin.app.vault.adapter.write).toHaveBeenCalled();
			importMock.mockRestore();
			if (previousNormalizePath) {
				(
					Obsidian as { normalizePath: (path: string) => string }
				).normalizePath = previousNormalizePath;
			} else {
				delete (
					Obsidian as { normalizePath?: (path: string) => string }
				).normalizePath;
			}
		});
	});

	describe("path preparation and logging preconditions", () => {
		it("creates saveLocation and log file before syncing (basic import)", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			const saveLocation = plugin.settings.saveLocation;
			const logPath = `${saveLocation}/_KeepSidianLogs/${new Date()
				.toISOString()
				.slice(0, 10)}.md`;

			const existsMock = jest.fn(async (p: string) => false);
			const createFolderMock = jest.fn().mockResolvedValue(undefined);
			const writeMock = jest.fn().mockResolvedValue(undefined);

			plugin.app = {
				vault: {
					adapter: {
						exists: existsMock,
						read: jest.fn().mockResolvedValue(""),
						write: writeMock,
					},
					createFolder: createFolderMock,
				},
			} as any;

			jest.spyOn(SyncModule, "importGoogleKeepNotes").mockResolvedValue(
				0
			);
			await plugin.importNotes();

			expect(createFolderMock).toHaveBeenCalledWith(saveLocation);
			expect(writeMock).toHaveBeenCalledWith(logPath, expect.any(String));
		});

		it("shows error and aborts when saveLocation cannot be created", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			const saveLocation = plugin.settings.saveLocation;

			const notice = Notice as unknown as jest.Mock;

			plugin.app = {
				vault: {
					adapter: { exists: jest.fn().mockResolvedValue(false) },
					createFolder: jest
						.fn()
						.mockRejectedValue(new Error("perm denied")),
				},
			} as any;

			const importSpy = jest
				.spyOn(SyncModule, "importGoogleKeepNotes")
				.mockResolvedValue(0);
			await plugin.importNotes();

			expect(notice).toHaveBeenCalledWith(
				`KeepSidian: Failed to create save location: ${saveLocation}`
			);
			expect(importSpy).not.toHaveBeenCalled();
		});

		it("shows error and aborts when log file cannot be prepared", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			const saveLocation = plugin.settings.saveLocation;
			const logPath = `${saveLocation}/_KeepSidianLogs/${new Date()
				.toISOString()
				.slice(0, 10)}.md`;

			const notice = Notice as unknown as jest.Mock;

			plugin.app = {
				vault: {
					adapter: {
						exists: jest.fn(
							async (p: string) => p === saveLocation
						),
						read: jest.fn().mockResolvedValue(""),
						write: jest
							.fn()
							.mockRejectedValue(new Error("write failed")),
					},
					createFolder: jest.fn().mockResolvedValue(undefined),
				},
			} as any;

			const importSpy = jest
				.spyOn(SyncModule, "importGoogleKeepNotes")
				.mockResolvedValue(0);
			await plugin.importNotes();

			expect(notice).toHaveBeenCalledWith(
				`KeepSidian: Failed to create log file: ${logPath}`
			);
			expect(importSpy).not.toHaveBeenCalled();
		});

		it("shows an error Notice if log append fails during sync, but does not crash", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			const saveLocation = plugin.settings.saveLocation;
			const logPath = `${saveLocation}/_KeepSidianLogs/${new Date()
				.toISOString()
				.slice(0, 10)}.md`;

			const exists = jest.fn(
				async (p: string) => p === saveLocation || p === logPath
			);
			const read = jest.fn().mockResolvedValue("");
			const write = jest
				.fn()
				.mockImplementation(async (_p: string, _c: string) => {
					// Fail only on non-empty writes (append during sync)
					if (_c && _c.length > 0) {
						throw new Error("append failed");
					}
				});

			plugin.app = {
				vault: {
					adapter: { exists, read, write },
					createFolder: jest.fn().mockResolvedValue(undefined),
				},
			} as any;

			jest.spyOn(SyncModule, "importGoogleKeepNotes").mockResolvedValue(
				0
			);

			const notice = Notice as unknown as jest.Mock;
			const previousNormalizePath = (
				Obsidian as { normalizePath?: (path: string) => string }
			).normalizePath;
			(
				Obsidian as { normalizePath: (path: string) => string }
			).normalizePath = (p: string) => p;
			await plugin.importNotes();
			if (previousNormalizePath) {
				(
					Obsidian as { normalizePath: (path: string) => string }
				).normalizePath = previousNormalizePath;
			} else {
				delete (
					Obsidian as { normalizePath?: (path: string) => string }
				).normalizePath;
			}

			expect(notice).toHaveBeenCalledWith(
				"KeepSidian: Failed to write sync log."
			);
		});

		it("logs started and ended entries for manual sync", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			const saveLocation = plugin.settings.saveLocation;
			const logPath = `${saveLocation}/_KeepSidianLogs/${new Date()
				.toISOString()
				.slice(0, 10)}.md`;

			const exists = jest.fn(
				async (p: string) => p === saveLocation || p === logPath
			);
			const read = jest.fn().mockResolvedValue("");
			const write = jest.fn().mockResolvedValue(undefined);

			plugin.app = {
				vault: {
					adapter: { exists, read, write },
					createFolder: jest.fn().mockResolvedValue(undefined),
				},
			} as any;

			jest.spyOn(SyncModule, "importGoogleKeepNotes").mockResolvedValue(
				0
			);
			await plugin.importNotes(false);

			const writes = (write as jest.Mock).mock.calls.map((c) => c[1]);
			expect(
				writes.some((c: string) => c.includes("Manual sync started"))
			).toBe(true);
			expect(
				writes.some((c: string) => c.includes("Manual sync ended"))
			).toBe(true);
			// Lines are markdown list items
			const startedLine = writes.find((c: string) =>
				c.includes("Manual sync started")
			) as string;
			expect(startedLine.trim().startsWith("- ")).toBe(true);
		});

		it("logs started and ended entries for auto sync", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			const saveLocation = plugin.settings.saveLocation;
			const logPath = `${saveLocation}/_KeepSidianLogs/${new Date()
				.toISOString()
				.slice(0, 10)}.md`;

			const exists = jest.fn(
				async (p: string) => p === saveLocation || p === logPath
			);
			const read = jest.fn().mockResolvedValue("");
			const write = jest.fn().mockResolvedValue(undefined);

			plugin.app = {
				vault: {
					adapter: { exists, read, write },
					createFolder: jest.fn().mockResolvedValue(undefined),
				},
			} as any;

			jest.spyOn(SyncModule, "importGoogleKeepNotes").mockResolvedValue(
				0
			);
			await plugin.importNotes(true);

			const writes = (write as jest.Mock).mock.calls.map((c) => c[1]);
			expect(
				writes.some((c: string) => c.includes("Auto sync started"))
			).toBe(true);
			expect(
				writes.some((c: string) => c.includes("Auto sync ended"))
			).toBe(true);
		});
	});

	describe("settings", () => {
		it("should load and merge settings with defaults", async () => {
			const savedSettings = { email: "test@example.com" };
			plugin.loadData = jest.fn().mockResolvedValue(savedSettings);

			await plugin.loadSettings();

			expect(plugin.settings).toEqual({
				...DEFAULT_SETTINGS,
				...savedSettings,
			});
		});

		it("should save settings", async () => {
			const testSettings = {
				...DEFAULT_SETTINGS,
				email: "test@example.com",
			};
			plugin.settings = testSettings;

			await plugin.saveSettings();

			expect(plugin.saveData).toHaveBeenCalledWith(testSettings);
		});
	});
});
