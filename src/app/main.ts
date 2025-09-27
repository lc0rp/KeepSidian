import { Notice, Plugin } from "obsidian";
import type { DataAdapter } from "obsidian";
import type {
	KeepSidianPluginSettings,
	LastSyncSummary,
	SyncMode,
} from "../types/keepsidian-plugin-settings";
import { DEFAULT_SETTINGS } from "../types/keepsidian-plugin-settings";
import { SubscriptionService } from "@services/subscription";
import { NoteImportOptions, NoteImportOptionsModal } from "@ui/modals/NoteImportOptionsModal";
import { SyncProgressModal } from "@ui/modals/SyncProgressModal";
import {
	startSyncUI,
	finishSyncUI,
	setTotalNotes as uiSetTotalNotes,
	reportSyncProgress,
	initializeStatusBar,
} from "@app/sync-ui";
import { logSync, prepareSyncLog } from "@app/logging";
import { KeepSidianSettingsTab } from "@ui/settings/KeepSidianSettingsTab";
import { registerRibbonAndCommands } from "@app/commands";
import { importGoogleKeepNotes, importGoogleKeepNotesWithOptions } from "@features/keep/sync";
import { pushGoogleKeepNotes } from "@features/keep/push";
import { ensureFolder, normalizePathSafe } from "@services/paths";

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default class KeepSidianPlugin extends Plugin {
	settings: KeepSidianPluginSettings;
	subscriptionService: SubscriptionService;
	statusBarItemEl: HTMLElement | null = null;
	// Elements for visual status in the status bar
	statusTextEl: HTMLSpanElement | null = null;
	progressContainerEl: HTMLDivElement | null = null;
	progressBarEl: HTMLDivElement | null = null;
	progressModal: SyncProgressModal | null = null;
	progressNotice: Notice | null = null;
	processedNotes = 0;
	totalNotes: number | null = null;
	lastSyncSummary: LastSyncSummary | null = null;
	lastSyncLogPath: string | null = null;
	currentSyncMode: SyncMode | null = null;
	private autoSyncInterval?: number;
	private isSyncing = false;

	async onload() {
		await this.loadSettings();

		this.subscriptionService = new SubscriptionService(
			() => this.settings.email,
			() => this.settings.subscriptionCache,
			async (cache) => {
				this.settings.subscriptionCache = cache;
				await this.saveSettings();
			}
		);

		registerRibbonAndCommands(this);
		initializeStatusBar(this);
		this.initializeSettings();

		if (this.settings.autoSyncEnabled) {
			this.startAutoSync();
		}
	}

	private initializeSettings() {
		this.addSettingTab(new KeepSidianSettingsTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.lastSyncSummary = this.settings.lastSyncSummary ?? null;
		this.lastSyncLogPath = this.settings.lastSyncLogPath ?? null;
	}

	async saveSettings() {
		this.settings.lastSyncSummary = this.lastSyncSummary;
		this.settings.lastSyncLogPath = this.lastSyncLogPath ?? null;
		await this.saveData(this.settings);
	}

	isSyncInProgress(): boolean {
		return this.isSyncing;
	}

	openSyncProgressModal() {
		if (!this.progressModal) {
			this.progressModal = new SyncProgressModal(this.app, {
				onTwoWaySync: () => this.performTwoWaySync(),
				onImportOnly: () => this.importNotes(),
				onUploadOnly: () => this.pushNotes(),
				onOpenSyncLog: () => this.openLatestSyncLog(),
				onClose: () => {
					this.progressModal = null;
				},
			});
		}

		if (this.isSyncInProgress()) {
			const total = this.totalNotes ?? undefined;
			this.progressModal.setProgress(this.processedNotes, total);
		} else {
			this.progressModal.setIdleSummary(this.lastSyncSummary);
		}

		this.progressModal.open();
	}

	async openLatestSyncLog() {
		const adapter: DataAdapter | null = this.app?.vault?.adapter ?? null;
		if (!adapter) {
			new Notice("KeepSidian: Unable to open sync log.");
			return;
		}

		let logPath = this.lastSyncLogPath;
		const logsFolder = normalizePathSafe(`${this.settings.saveLocation}/_KeepSidianLogs`);

		if (!logPath) {
			if (typeof adapter.list === "function") {
				try {
					const { files } = await adapter.list(logsFolder);
					const markdownFiles = (files ?? [])
						.map((file: string) => {
							const normalized = normalizePathSafe(file);
							return normalized.startsWith(logsFolder)
								? normalized
								: normalizePathSafe(`${logsFolder}/${normalized.split("/").pop()}`);
						})
						.filter((file: string) => file.toLowerCase().endsWith(".md"));
					if (!markdownFiles.length) {
						new Notice("KeepSidian: No sync logs found.");
						return;
					}
					markdownFiles.sort();
					logPath = markdownFiles[markdownFiles.length - 1];
				} catch {
					new Notice("KeepSidian: Failed to open sync log.");
					return;
				}
			} else {
				new Notice("KeepSidian: No sync logs found.");
				return;
			}
		}

		if (!logPath) {
			new Notice("KeepSidian: No sync logs found.");
			return;
		}

		const normalizedPath = normalizePathSafe(logPath);
		this.lastSyncLogPath = normalizedPath;
		this.settings.lastSyncLogPath = normalizedPath;

		if (typeof this.app?.workspace?.openLinkText === "function") {
			this.app.workspace.openLinkText(normalizedPath, "", true);
		} else {
			new Notice("KeepSidian: Unable to open sync log.");
		}
	}

	private async ensureStoragePathsOrThrow(): Promise<void> {
		const saveLocation = this.settings.saveLocation;
		try {
			await ensureFolder(this.app, saveLocation);
		} catch (error: unknown) {
			new Notice(`KeepSidian: Failed to create save location: ${saveLocation}`);
			throw error;
		}
	}

	async showImportOptionsModal(): Promise<void> {
		return new Promise((resolve) => {
			new NoteImportOptionsModal(this.app, this, async (options: NoteImportOptions) => {
				try {
					await this.ensureStoragePathsOrThrow();
				} catch {
					resolve();
					return;
				}

				// Prepare log file; abort if not possible
				const logPrepared = await prepareSyncLog(this);
				if (!logPrepared) {
					resolve();
					return;
				}

				const batchOptions = {
					batchSize: 2,
					batchKey: "start-manual-sync",
				};
				await logSync(this, `\n\n---\n`, batchOptions);
				await logSync(this, `Manual sync started`, batchOptions);
				this.currentSyncMode = "import";
				startSyncUI(this);
				try {
					await importGoogleKeepNotesWithOptions(this, options, {
						setTotalNotes: (n) => uiSetTotalNotes(this, n),
						reportProgress: () => reportSyncProgress(this),
					});
					await logSync(
						this,
						`Manual sync ended - success. Processed ${this.processedNotes} note(s).`
					);
					finishSyncUI(this, true);
				} catch (error: unknown) {
					finishSyncUI(this, false);
					await logSync(
						this,
						`Manual sync ended - failed: ${getErrorMessage(error)}. Processed ${
							this.processedNotes
						} note(s).`
					);
					resolve();
				}
			}).open();
		});
	}

	async importNotes(auto = false) {
		if (this.isSyncing) {
			return;
		}
		this.isSyncing = true;
		try {
			const isSubscriptionActive = await this.subscriptionService.isSubscriptionActive();

			if (!auto && isSubscriptionActive) {
				await this.showImportOptionsModal();
				return;
			} else {
				try {
					await this.ensureStoragePathsOrThrow();
				} catch {
					return;
				}

				// Prepare log file; abort if not possible
				const logPrepared = await prepareSyncLog(this);
				if (!logPrepared) {
					return;
				}

				const batchOptions = { batchSize: 2, batchKey: "start-sync" };
				await logSync(this, `\n\n---\n`, batchOptions);
				await logSync(this, `${auto ? "Auto" : "Manual"} sync started`, batchOptions);
				this.currentSyncMode = "import";
				startSyncUI(this);
				try {
					await importGoogleKeepNotes(this, {
						setTotalNotes: (n) => uiSetTotalNotes(this, n),
						reportProgress: () => reportSyncProgress(this),
					});
					await logSync(
						this,
						`${auto ? "Auto" : "Manual"} sync ended - success. Processed ${
							this.processedNotes
						} note(s).`
					);
					finishSyncUI(this, true);
				} catch (error: unknown) {
					finishSyncUI(this, false);
					const errorMessage = getErrorMessage(error);
					await logSync(
						this,
						`${auto ? "Auto" : "Manual"} sync ended - failed: ${errorMessage}. Processed ${
							this.processedNotes
						} note(s).`
					);
				}
			}
		} catch (error: unknown) {
			const errorMessage = getErrorMessage(error);
			await logSync(
				this,
				`${auto ? "Auto" : "Manual"} sync ended - failed: ${errorMessage}. Processed ${
					this.processedNotes
				} note(s).`
			);
		} finally {
			this.isSyncing = false;
		}
	}

	async pushNotes() {
		if (this.isSyncing) {
			return;
		}
		this.isSyncing = true;
		try {
			try {
				await this.ensureStoragePathsOrThrow();
			} catch {
				return;
			}

			const logPrepared = await prepareSyncLog(this);
			if (!logPrepared) {
				return;
			}

			const batchOptions = { batchSize: 2, batchKey: "start-push-sync" };
			await logSync(this, `\n\n---\n`, batchOptions);
			await logSync(this, `Push sync started`, batchOptions);
			this.currentSyncMode = "push";
			startSyncUI(this);
			try {
				const pushed = await pushGoogleKeepNotes(this, {
					setTotalNotes: (n) => uiSetTotalNotes(this, n),
					reportProgress: () => reportSyncProgress(this),
				});
				await logSync(this, `Push sync ended - success. Pushed ${pushed} note(s).`);
				finishSyncUI(this, true);
			} catch (error: unknown) {
				finishSyncUI(this, false);
				const errorMessage = getErrorMessage(error);
				await logSync(
					this,
					`Push sync ended - failed: ${errorMessage}. Processed ${this.processedNotes} note(s).`
				);
			}
		} catch (error: unknown) {
			const errorMessage = getErrorMessage(error);
			await logSync(
				this,
				`Push sync ended - failed: ${errorMessage}. Processed ${this.processedNotes} note(s).`
			);
		} finally {
			this.isSyncing = false;
		}
	}

	private resetProgressIndicatorsForNextStage() {
		this.processedNotes = 0;
		this.totalNotes = null;
		if (this.statusTextEl) {
			this.statusTextEl.textContent = "Sync: 0/?";
		}
		if (this.progressContainerEl) {
			this.progressContainerEl.style.display = "";
			this.progressContainerEl.classList.remove("complete", "failed");
			if (!this.progressContainerEl.classList.contains("indeterminate")) {
				this.progressContainerEl.classList.add("indeterminate");
			}
		}
		if (this.progressBarEl) {
			this.progressBarEl.style.width = "";
			this.progressBarEl.classList.remove("paused");
		}
		this.progressModal?.setProgress(0, undefined);
	}

	async performTwoWaySync() {
		if (this.isSyncing) {
			return;
		}
		this.isSyncing = true;
		try {
			try {
				await this.ensureStoragePathsOrThrow();
			} catch {
				return;
			}

			const logPrepared = await prepareSyncLog(this);
			if (!logPrepared) {
				return;
			}

			const batchOptions = {
				batchSize: 2,
				batchKey: "start-2way-sync",
			};
			await logSync(this, `\n\n---\n`, batchOptions);
			await logSync(this, `Two-way sync started`, batchOptions);
			this.currentSyncMode = "two-way";
			startSyncUI(this);
			const callbacks = {
				setTotalNotes: (n: number) => uiSetTotalNotes(this, n),
				reportProgress: () => reportSyncProgress(this),
			};

			let importProcessed = 0;
			try {
				await importGoogleKeepNotes(this, callbacks);
				importProcessed = this.processedNotes;
				await logSync(
					this,
					`Two-way sync - import completed. Processed ${importProcessed} note(s).`
				);
			} catch (error: unknown) {
				finishSyncUI(this, false);
				const errorMessage = getErrorMessage(error);
				await logSync(
					this,
					`Two-way sync ended - import failed: ${errorMessage}. Processed ${this.processedNotes} note(s).`
				);
				return;
			}

			this.resetProgressIndicatorsForNextStage();
			await logSync(this, `Two-way sync - starting push stage`);

			try {
				const pushed = await pushGoogleKeepNotes(this, callbacks);
				await logSync(
					this,
					`Two-way sync ended - success. Imported ${importProcessed} note(s), pushed ${pushed} note(s).`
				);
				finishSyncUI(this, true);
			} catch (error: unknown) {
				finishSyncUI(this, false);
				const errorMessage = getErrorMessage(error);
				await logSync(
					this,
					`Two-way sync ended - push failed: ${errorMessage}. Processed ${this.processedNotes} note(s).`
				);
			}
		} catch (error: unknown) {
			const errorMessage = getErrorMessage(error);
			await logSync(
				this,
				`Two-way sync ended - failed: ${errorMessage}. Processed ${this.processedNotes} note(s).`
			);
		} finally {
			this.isSyncing = false;
		}
	}

	startAutoSync() {
		this.stopAutoSync();
		const intervalMs = this.settings.autoSyncIntervalHours * 60 * 60 * 1000;
		this.autoSyncInterval = window.setInterval(() => {
			if (!this.isSyncing) {
				this.importNotes(true);
			}
		}, intervalMs);
		if (
			this.autoSyncInterval !== undefined &&
			typeof this.registerInterval === "function"
		) {
			this.registerInterval(this.autoSyncInterval);
		}
	}

	stopAutoSync() {
		if (this.autoSyncInterval) {
			window.clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = undefined;
		}
	}

	private async logSync(message: string) {
		/* moved to app/logging.ts */
	}
}
