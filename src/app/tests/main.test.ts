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
import { registerCommands } from "../../app/commands";
import * as LoggingModule from "../../app/logging";

describe("KeepSidianPlugin", () => {
	let plugin: KeepSidianPlugin;
	let mockApp: jest.Mocked<Plugin["app"]>;

	function setTestCredentials(target: KeepSidianPlugin) {
		target.settings.email = "tester@example.com";
		target.settings.token = "test-token";
	}

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
		} as unknown as jest.Mocked<Plugin["app"]>;

		plugin = new KeepSidianPlugin(mockApp, TEST_MANIFEST);

		plugin.loadData = jest.fn().mockResolvedValue({});
		plugin.saveData = jest.fn().mockResolvedValue(undefined);
		plugin.addRibbonIcon = jest.fn();
		plugin.addCommand = jest.fn();
		plugin.addSettingTab = jest.fn();
		const statusBarItem = document.createElement("div") as unknown as HTMLElement & {
			setText: jest.Mock;
			setAttribute: jest.Mock;
			addEventListener: jest.Mock;
			createEl: jest.Mock;
		};
		statusBarItem.setText = jest.fn();
		statusBarItem.setAttribute = jest.fn();
		statusBarItem.addEventListener = jest.fn();
		statusBarItem.createEl = jest.fn(
			<K extends keyof HTMLElementTagNameMap>(tagName: K) => {
				const child = document.createElement(tagName);
				statusBarItem.appendChild(child);
				return child;
			}
		);
		plugin.addStatusBarItem = jest
			.fn()
			.mockReturnValue(statusBarItem as unknown as ReturnType<Plugin["addStatusBarItem"]>);

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
			expect(plugin.addCommand).toHaveBeenCalledTimes(4);
			expect(
				(plugin.addCommand as jest.Mock).mock.calls.map(
					(call) => call[0].id
				)
			).toEqual([
				"two-way-sync-google-keep",
				"import-google-keep-notes",
				"push-google-keep-notes",
				"open-sync-log-file",
			]);
			expect(plugin.addSettingTab).toHaveBeenCalledWith(
				expect.any(KeepSidianSettingsTab)
			);
			expect(plugin.statusTextEl?.textContent).toBe("Last sync: never");
			const statusEl = (plugin.addStatusBarItem as jest.Mock).mock
				.results[0].value;
			expect(statusEl.setAttribute).toHaveBeenCalledWith(
				"title",
				"KeepSidian has not synced yet."
			);
		});
	});

	describe("importNotes", () => {
		it("should use basic import for non-premium users", async () => {
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
			} as unknown as Plugin["app"];

			await plugin.onload();
			setTestCredentials(plugin);
			const isSubscriptionActiveSpy = jest
				.spyOn(plugin.subscriptionService, "isSubscriptionActive")
				.mockResolvedValue(false);

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
				expect.stringMatching(/Syncing Google Keep Notes\.\.\. 0\/\?/),
				0
			);
			expect(plugin.progressNotice).not.toBeNull();
			const statusEl = (plugin.addStatusBarItem as jest.Mock).mock
				.results[0].value;
			const tooltipCalls = (statusEl.setAttribute as jest.Mock).mock.calls
				.filter(([attr]) => attr === "title")
				.map(([, value]) => value);
			expect(tooltipCalls).toContain("KeepSidian syncing...");
			expect(
				tooltipCalls.some((value: string) =>
					value.startsWith("KeepSidian last synced")
				)
			).toBe(true);
			expect(plugin.statusTextEl?.textContent).toContain("Last synced");
			isSubscriptionActiveSpy.mockRestore();
		});

		it("updates the sync notice as progress advances", async () => {
			const setMessage = jest.fn();
			(Notice as unknown as jest.Mock).mockImplementationOnce(
				(message: string, timeout?: number) => ({
					message,
					timeout,
					setMessage,
					hide: jest.fn(),
				})
			);
			const importMock = jest
				.spyOn(SyncModule, "importGoogleKeepNotes")
				.mockImplementation(async (_plugin, callbacks) => {
					callbacks?.setTotalNotes?.(2);
					callbacks?.reportProgress?.();
					return 1;
				});

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
			} as unknown as Plugin["app"];

			await plugin.onload();
			setTestCredentials(plugin);
			const isSubscriptionActiveSpy = jest
				.spyOn(plugin.subscriptionService, "isSubscriptionActive")
				.mockResolvedValue(false);

			await plugin.importNotes();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(setMessage).toHaveBeenCalledWith(
				"Syncing Google Keep Notes... 0/2"
			);
			expect(setMessage).toHaveBeenCalledWith(
				"Syncing Google Keep Notes... 1/2"
			);

			isSubscriptionActiveSpy.mockRestore();
			importMock.mockRestore();
		});

		it("should show options modal for premium users", async () => {
			await plugin.onload(); // Initialize the plugin and subscriptionService
			setTestCredentials(plugin);

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

	describe("openLatestSyncLog", () => {
		beforeEach(async () => {
			await plugin.onload();
			plugin.app = {
				workspace: {
					openLinkText: jest.fn(),
				},
				vault: {
					adapter: {
						list: jest
							.fn()
							.mockResolvedValue({ files: [], folders: [] }),
					},
				},
			} as unknown as Plugin["app"];
		});

		it("opens stored log path when available", async () => {
			const logPath = "Google Keep/_KeepSidianLogs/2024-01-01.md";
			plugin.lastSyncLogPath = logPath;
			plugin.settings.lastSyncLogPath = logPath;

			await plugin.openLatestSyncLog();

			expect(
				plugin.app.workspace.openLinkText as jest.Mock
			).toHaveBeenCalledWith(logPath, "", true);
		});

		it("selects the latest log when none is stored", async () => {
			plugin.lastSyncLogPath = null;
			plugin.settings.lastSyncLogPath = null;
			const adapter = plugin.app.vault.adapter as unknown as {
				list: jest.Mock;
			};
			adapter.list.mockResolvedValue({
				files: [
					"Google Keep/_KeepSidianLogs/2024-01-01.md",
					"Google Keep/_KeepSidianLogs/2024-01-03.md",
					"Google Keep/_KeepSidianLogs/2024-01-02.md",
				],
				folders: [],
			});

			await plugin.openLatestSyncLog();

			expect(
				plugin.app.workspace.openLinkText as jest.Mock
			).toHaveBeenCalledWith(
				"Google Keep/_KeepSidianLogs/2024-01-03.md",
				"",
				true
			);
			expect(plugin.lastSyncLogPath).toBe(
				"Google Keep/_KeepSidianLogs/2024-01-03.md"
			);
		});

		it("shows a notice when no logs are available", async () => {
			plugin.lastSyncLogPath = null;
			plugin.settings.lastSyncLogPath = null;
			(Notice as unknown as jest.Mock).mockClear();

			await plugin.openLatestSyncLog();

			expect(Notice).toHaveBeenCalledWith(
				"KeepSidian: No sync logs found."
			);
			expect(
				plugin.app.workspace.openLinkText as jest.Mock
			).not.toHaveBeenCalled();
		});
	});

	describe("auto sync", () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		const flushMicrotasks = async () => {
			for (let i = 0; i < 5; i += 1) {
				await Promise.resolve();
			}
		};

		const advanceOneInterval = async () => {
			jest.advanceTimersByTime(60 * 60 * 1000);
			await flushMicrotasks();
		};

		it("should start auto sync when enabled", async () => {
			plugin.loadData = jest.fn().mockResolvedValue({
				autoSyncEnabled: true,
				autoSyncIntervalHours: 1,
			});
			const importSpy = jest
				.spyOn(plugin, "importNotes")
				.mockResolvedValue();
			await plugin.onload();
			const runTick = (
				plugin as unknown as { runAutoSyncTick: () => Promise<void> }
			).runAutoSyncTick;
			await runTick.call(plugin);
			await flushMicrotasks();
			expect(importSpy).toHaveBeenCalledWith(true);
		});

		it("runs two-way sync when safeguards allow upgrade", async () => {
			plugin.settings = {
				...DEFAULT_SETTINGS,
				autoSyncEnabled: true,
				autoSyncIntervalHours: 1,
				twoWaySyncBackupAcknowledged: true,
				twoWaySyncEnabled: true,
				twoWaySyncAutoSyncEnabled: true,
			};
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(true);
			const performTwoWaySpy = jest
				.spyOn(plugin, "performTwoWaySync")
				.mockResolvedValue();
			const importSpy = jest
				.spyOn(plugin, "importNotes")
				.mockResolvedValue();
			plugin.startAutoSync();
			try {
				await advanceOneInterval();
				expect(plugin.subscriptionService.isSubscriptionActive).toHaveBeenCalledWith(true);
				expect(performTwoWaySpy).toHaveBeenCalledTimes(1);
				expect(importSpy).not.toHaveBeenCalled();
			} finally {
				plugin.stopAutoSync();
				performTwoWaySpy.mockRestore();
				importSpy.mockRestore();
			}
		});

		it("logs gating reasons and avoids duplicate notices when safeguards fail", async () => {
			plugin.settings = {
				...DEFAULT_SETTINGS,
				autoSyncEnabled: true,
				autoSyncIntervalHours: 1,
				twoWaySyncBackupAcknowledged: true,
				twoWaySyncEnabled: false,
				twoWaySyncAutoSyncEnabled: false,
			};
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(true);
			const logSyncSpy = jest
				.spyOn(LoggingModule, "logSync")
				.mockResolvedValue();
			const noticeSpy = jest
				.spyOn(plugin, "showTwoWaySafeguardNotice")
				.mockImplementation(() => {});
			const importSpy = jest
				.spyOn(plugin, "importNotes")
				.mockResolvedValue();
			plugin.startAutoSync();
			try {
				await advanceOneInterval();
				const runTick = (
					plugin as unknown as { runAutoSyncTick: () => Promise<void> }
				).runAutoSyncTick;
				await runTick.call(plugin);
				await flushMicrotasks();
				const gatingMessages = logSyncSpy.mock.calls
					.map(([, message]) => message)
					.filter((message) =>
						message.includes("Auto sync skipped uploads")
					);
				expect(gatingMessages.length).toBeGreaterThanOrEqual(2);
				expect(gatingMessages[0]).toContain(
					"Please enable in settings first."
				);
				expect(importSpy).toHaveBeenCalledTimes(2);
				expect(importSpy).toHaveBeenNthCalledWith(1, true);
				expect(noticeSpy).toHaveBeenCalledTimes(1);
			} finally {
				plugin.stopAutoSync();
				logSyncSpy.mockRestore();
				noticeSpy.mockRestore();
				importSpy.mockRestore();
			}
		});

		it("should log sync results to file", async () => {
			plugin.subscriptionService.isSubscriptionActive = jest
				.fn()
				.mockResolvedValue(false);
			plugin.settings = { ...DEFAULT_SETTINGS };
			setTestCredentials(plugin);
			plugin.app = {
				vault: {
					adapter: {
						exists: jest.fn().mockResolvedValue(true),
						read: jest.fn().mockResolvedValue(""),
						write: jest.fn().mockResolvedValue(undefined),
					},
				},
			} as unknown as Plugin["app"];
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
			setTestCredentials(plugin);
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
			} as unknown as Plugin["app"];

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
			setTestCredentials(plugin);
			const saveLocation = plugin.settings.saveLocation;

			const notice = Notice as unknown as jest.Mock;

			plugin.app = {
				vault: {
					adapter: { exists: jest.fn().mockResolvedValue(false) },
					createFolder: jest
						.fn()
						.mockRejectedValue(new Error("perm denied")),
				},
			} as unknown as Plugin["app"];

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
			setTestCredentials(plugin);
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
			} as unknown as Plugin["app"];

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
			setTestCredentials(plugin);
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
			} as unknown as Plugin["app"];

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
			setTestCredentials(plugin);
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
			} as unknown as Plugin["app"];

			jest.spyOn(SyncModule, "importGoogleKeepNotes").mockResolvedValue(
				0
			);
			await plugin.importNotes(false);

			const writes = (write).mock.calls.map((c) => c[1]);
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
			setTestCredentials(plugin);
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
			} as unknown as Plugin["app"];

			jest.spyOn(SyncModule, "importGoogleKeepNotes").mockResolvedValue(
				0
			);
			await plugin.importNotes(true);

			const writes = (write).mock.calls.map((c) => c[1]);
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

	describe("loadSettings safeguards", () => {
		it("forces beta toggles off when backups are not acknowledged", async () => {
			plugin.loadData = jest.fn().mockResolvedValue({
				...DEFAULT_SETTINGS,
				twoWaySyncBackupAcknowledged: false,
				twoWaySyncEnabled: true,
				twoWaySyncAutoSyncEnabled: true,
			});

			await plugin.loadSettings();

			expect(plugin.settings.twoWaySyncBackupAcknowledged).toBe(false);
			expect(plugin.settings.twoWaySyncEnabled).toBe(false);
			expect(plugin.settings.twoWaySyncAutoSyncEnabled).toBe(false);
		});

		it("disables auto two-way when manual two-way is off", async () => {
			plugin.loadData = jest.fn().mockResolvedValue({
				...DEFAULT_SETTINGS,
				twoWaySyncBackupAcknowledged: true,
				twoWaySyncEnabled: false,
				twoWaySyncAutoSyncEnabled: true,
			});

			await plugin.loadSettings();

			expect(plugin.settings.twoWaySyncBackupAcknowledged).toBe(true);
			expect(plugin.settings.twoWaySyncEnabled).toBe(false);
			expect(plugin.settings.twoWaySyncAutoSyncEnabled).toBe(false);
		});
	});

	describe("two-way safeguards", () => {
		beforeEach(async () => {
			await plugin.onload();
		});

		it("returns gating reasons when safeguards are incomplete", async () => {
			const result = await plugin.requireTwoWaySafeguards();
			expect(result.allowed).toBe(false);
			expect(result.reasons).toContain(
				"Please opt-in in settings first."
			);
		});

		it("allows uploads when safeguards and subscription requirements are met", async () => {
			plugin.settings.twoWaySyncBackupAcknowledged = true;
			plugin.settings.twoWaySyncEnabled = true;
			const subscriptionSpy = jest
				.spyOn(plugin.subscriptionService, "isSubscriptionActive")
				.mockResolvedValue(true);

			const result = await plugin.requireTwoWaySafeguards();
			expect(subscriptionSpy).toHaveBeenCalled();
			expect(result.allowed).toBe(true);
			subscriptionSpy.mockRestore();
		});

		it("prevents two-way command execution when safeguards fail", async () => {
			registerCommands(plugin);
			const addCommandMock = plugin.addCommand as jest.Mock;
			const command = addCommandMock.mock.calls.find(
				([options]) => options.id === "two-way-sync-google-keep"
			)?.[0];
			expect(command).toBeDefined();
			const gateNotice = jest
				.spyOn(plugin, "showTwoWaySafeguardNotice")
				.mockImplementation(() => {});
			const syncSpy = jest
				.spyOn(plugin, "performTwoWaySync")
				.mockResolvedValue(undefined);

			await command.callback();

			expect(syncSpy).not.toHaveBeenCalled();
			expect(gateNotice).toHaveBeenCalled();
			syncSpy.mockRestore();
			gateNotice.mockRestore();
		});

		it("prevents upload command execution when safeguards fail", async () => {
			registerCommands(plugin);
			const addCommandMock = plugin.addCommand as jest.Mock;
			const command = addCommandMock.mock.calls.find(
				([options]) => options.id === "push-google-keep-notes"
			)?.[0];
			expect(command).toBeDefined();
			const gateNotice = jest
				.spyOn(plugin, "showTwoWaySafeguardNotice")
				.mockImplementation(() => {});
			const pushSpy = jest
				.spyOn(plugin, "pushNotes")
				.mockResolvedValue(undefined);

			await command.callback();

			expect(pushSpy).not.toHaveBeenCalled();
			expect(gateNotice).toHaveBeenCalled();
			pushSpy.mockRestore();
			gateNotice.mockRestore();
		});

		it("executes commands when safeguards pass", async () => {
			plugin.settings.twoWaySyncBackupAcknowledged = true;
			plugin.settings.twoWaySyncEnabled = true;
			const subscriptionSpy = jest
				.spyOn(plugin.subscriptionService, "isSubscriptionActive")
				.mockResolvedValue(true);
			registerCommands(plugin);
			const addCommandMock = plugin.addCommand as jest.Mock;
			const twoWayCommand = addCommandMock.mock.calls.find(
				([options]) => options.id === "two-way-sync-google-keep"
			)?.[0];
			const pushCommand = addCommandMock.mock.calls.find(
				([options]) => options.id === "push-google-keep-notes"
			)?.[0];
			const syncSpy = jest
				.spyOn(plugin, "performTwoWaySync")
				.mockResolvedValue(undefined);
			const pushSpy = jest
				.spyOn(plugin, "pushNotes")
				.mockResolvedValue(undefined);

			await twoWayCommand.callback();
			await pushCommand.callback();

			expect(syncSpy).toHaveBeenCalled();
			expect(pushSpy).toHaveBeenCalled();
			syncSpy.mockRestore();
			pushSpy.mockRestore();
			subscriptionSpy.mockRestore();
		});
	});
});
