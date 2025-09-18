import { Notice, Plugin } from "obsidian";
import type { KeepSidianPluginSettings } from "../types/keepsidian-plugin-settings";
import { DEFAULT_SETTINGS } from "../types/keepsidian-plugin-settings";
import { SubscriptionService } from "@services/subscription";
import {
	NoteImportOptions,
	NoteImportOptionsModal,
} from "@ui/modals/NoteImportOptionsModal";
import { SyncProgressModal } from "@ui/modals/SyncProgressModal";
import {
	startSyncUI,
	finishSyncUI,
	setTotalNotes as uiSetTotalNotes,
	reportSyncProgress,
} from "@app/sync-ui";
import { logSync, prepareSyncLog } from "@app/logging";
import { KeepSidianSettingsTab } from "@ui/settings/KeepSidianSettingsTab";
import { registerRibbonAndCommands } from "@app/commands";
import {
	importGoogleKeepNotes,
	importGoogleKeepNotesWithOptions,
} from "@features/keep/sync";
import { ensureFolder } from "@services/paths";

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
		this.initializeSettings();

		if (this.settings.autoSyncEnabled) {
			this.startAutoSync();
		}
	}

	private initializeSettings() {
		this.addSettingTab(new KeepSidianSettingsTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async ensureStoragePathsOrThrow(): Promise<void> {
		const saveLocation = this.settings.saveLocation;
		try {
			await ensureFolder(this.app, saveLocation);
		} catch (e: any) {
			new Notice(
				`KeepSidian: Failed to create save location: ${saveLocation}`
			);
			throw e;
		}
	}

	async showImportOptionsModal(): Promise<void> {
		return new Promise((resolve) => {
			new NoteImportOptionsModal(
				this.app,
				this,
				async (options: NoteImportOptions) => {
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

					await logSync(this, `Manual sync started`);
					startSyncUI(this);
					try {
						await importGoogleKeepNotesWithOptions(
							this,
							options,
							{
								setTotalNotes: (n) => uiSetTotalNotes(this, n),
								reportProgress: () => reportSyncProgress(this),
							}
						);
						await logSync(
							this,
							`Manual sync ended - success. Processed ${this.processedNotes} note(s).`
						);
						finishSyncUI(this, true);
					} catch (error) {
						finishSyncUI(this, false);
						await logSync(
							this,
							`Manual sync ended - failed: ${
								(error as Error).message
							}. Processed ${this.processedNotes} note(s).`
						);
						resolve();
					}
				}
			).open();
		});
	}

	async importNotes(auto = false) {
		if (this.isSyncing) {
			return;
		}
		this.isSyncing = true;
		try {
			const isSubscriptionActive =
				await this.subscriptionService.isSubscriptionActive();

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

				await logSync(this, `${auto ? "Auto" : "Manual"} sync started`);
				startSyncUI(this);
				try {
					await importGoogleKeepNotes(this, {
						setTotalNotes: (n) => uiSetTotalNotes(this, n),
						reportProgress: () => reportSyncProgress(this),
					});
					await logSync(
						this,
						`${
							auto ? "Auto" : "Manual"
						} sync ended - success. Processed ${
							this.processedNotes
						} note(s).`
					);
					finishSyncUI(this, true);
				} catch (error: any) {
					finishSyncUI(this, false);
					await logSync(
						this,
						`${auto ? "Auto" : "Manual"} sync ended - failed: ${
							error.message
						}. Processed ${this.processedNotes} note(s).`
					);
				}
			}
		} catch (error: any) {
			await logSync(
				this,
				`${auto ? "Auto" : "Manual"} sync ended - failed: ${
					error.message
				}. Processed ${this.processedNotes} note(s).`
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
		if (typeof (this as any).registerInterval === "function") {
			(this as any).registerInterval(this.autoSyncInterval);
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
