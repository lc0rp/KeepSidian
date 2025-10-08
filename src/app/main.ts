import { Notice, Plugin } from "obsidian";
import type { DataAdapter, ProgressBarComponent } from "obsidian";
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
import { HIDDEN_CLASS } from "@app/ui-constants";
import { logSync, prepareSyncLog } from "@app/logging";
import { KeepSidianSettingsTab } from "@ui/settings/KeepSidianSettingsTab";
import { registerRibbonAndCommands } from "@app/commands";
import { importGoogleKeepNotes, importGoogleKeepNotesWithOptions } from "@features/keep/sync";
import { pushGoogleKeepNotes } from "@features/keep/push";
import { ensureFolder, normalizePathSafe } from "@services/paths";

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface TwoWayGateOptions {
	requirePremium?: boolean;
	requireAutoSync?: boolean;
}

interface TwoWayGateResult {
	allowed: boolean;
	reasons: string[];
}

export default class KeepSidianPlugin extends Plugin {
	settings: KeepSidianPluginSettings;
	subscriptionService: SubscriptionService;
	statusBarItemEl: HTMLElement | null = null;
	// Elements for visual status in the status bar
	statusTextEl: HTMLSpanElement | null = null;
	progressContainerEl: HTMLDivElement | null = null;
	progressBar: ProgressBarComponent | null = null;
	progressModal: SyncProgressModal | null = null;
	progressNotice: Notice | null = null;
	processedNotes = 0;
	totalNotes: number | null = null;
	lastSyncSummary: LastSyncSummary | null = null;
	lastSyncLogPath: string | null = null;
	currentSyncMode: SyncMode | null = null;
	private autoSyncInterval?: ReturnType<typeof setInterval>;
	private isSyncing = false;
	private subscriptionActive: boolean | null = null;
	private lastAutoSyncGateReasons: string[] | null = null;

	async onload() {
		await this.loadSettings();

		this.subscriptionService = new SubscriptionService(
			() => this.settings.email,
			() => this.settings.subscriptionCache,
			async (cache) => {
				this.settings.subscriptionCache = cache;
				this.refreshAutoSyncSafeguards();
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

	private ensureCredentials(): boolean {
		const email = this.settings.email?.trim();
		if (!email) {
			new Notice(
				"KeepSidian: Please enter your Google account email in the settings before syncing."
			);
			return false;
		}

		const token = this.settings.token?.trim();
		if (!token) {
			new Notice(
				"KeepSidian: Please add your Google Keep token in the settings before syncing."
			);
			return false;
		}

		return true;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.normalizeTwoWaySettings();
		this.lastSyncSummary = this.settings.lastSyncSummary ?? null;
		this.lastSyncLogPath = this.settings.lastSyncLogPath ?? null;
	}

	private normalizeTwoWaySettings() {
		if (!this.settings.twoWaySyncBackupAcknowledged) {
			if (this.settings.twoWaySyncEnabled) {
				this.settings.twoWaySyncEnabled = false;
			}
			if (this.settings.twoWaySyncAutoSyncEnabled) {
				this.settings.twoWaySyncAutoSyncEnabled = false;
			}
		} else if (!this.settings.twoWaySyncEnabled && this.settings.twoWaySyncAutoSyncEnabled) {
			this.settings.twoWaySyncAutoSyncEnabled = false;
		}
	}

	private getCachedSubscriptionActive(): boolean | null {
		const cachedInfo = this.settings.subscriptionCache?.info ?? null;
		if (!cachedInfo) {
			return null;
		}
		return cachedInfo.subscription_status === "active";
	}

	private computeTwoWayGate(
		options: TwoWayGateOptions = {},
		subscriptionOverride: boolean | null = null
	): TwoWayGateResult {
		const reasons: string[] = [];
		const requirePremium = options.requirePremium ?? true;
		const requireAutoSync = options.requireAutoSync ?? false;
		const backupAcknowledged = this.settings.twoWaySyncBackupAcknowledged;
		const manualEnabled = this.settings.twoWaySyncEnabled;
		const autoUploadsEnabled = this.settings.twoWaySyncAutoSyncEnabled;
		const autoSyncEnabled = this.settings.autoSyncEnabled;

		if (!backupAcknowledged) {
			reasons.push("Confirm vault backups in KeepSidian settings before enabling uploads.");
		}
		if (backupAcknowledged && !manualEnabled) {
			reasons.push("Enable two-way sync (beta) in KeepSidian settings to use uploads.");
		}

		const subscriptionActive =
			subscriptionOverride ?? this.subscriptionActive ?? this.getCachedSubscriptionActive();
		if (requirePremium && subscriptionActive === false) {
			reasons.push("KeepSidian Premium membership is required for uploads.");
		}

		if (requireAutoSync) {
			if (!autoSyncEnabled) {
				reasons.push("Turn on auto sync to run two-way sync automatically.");
			}
			if (!autoUploadsEnabled) {
				reasons.push(
					"Enable auto two-way sync in settings to include uploads in auto sync."
				);
			}
		}

		return {
			allowed: reasons.length === 0,
			reasons,
		};
	}

	getTwoWayGateSnapshot(options?: TwoWayGateOptions): TwoWayGateResult {
		this.normalizeTwoWaySettings();
		return this.computeTwoWayGate(options);
	}

	async requireTwoWaySafeguards(options?: TwoWayGateOptions): Promise<TwoWayGateResult> {
		this.normalizeTwoWaySettings();
		const requirePremium = options?.requirePremium ?? true;
		let subscriptionActive: boolean | null = this.subscriptionActive;
		try {
			if (requirePremium || subscriptionActive === null) {
				subscriptionActive = await this.subscriptionService.isSubscriptionActive();
				this.subscriptionActive = subscriptionActive;
			}
		} catch {
			// Subscription checks surface Notices internally; fall back to cached state.
		}
		return this.computeTwoWayGate(options, subscriptionActive);
	}

	showTwoWaySafeguardNotice(result: TwoWayGateResult) {
		if (result.allowed) {
			return;
		}

		const doc = this.app.workspace?.containerEl?.ownerDocument ?? null;
		if (!doc) {
			new Notice("KeepSidian uploads are locked until prerequisites are met.", 10000);
			return;
		}

		const fragment = doc.createDocumentFragment();
		const heading = doc.createElement("div");
		heading.classList.add("keepsidian-notice-heading");
		heading.textContent = "KeepSidian uploads are locked until you:";
		fragment.appendChild(heading);

		const list = doc.createElement("ul");
		list.classList.add("keepsidian-notice-list");
		for (const reason of result.reasons) {
			const listItem = doc.createElement("li");
			listItem.textContent = reason;
			list.appendChild(listItem);
		}
		fragment.appendChild(list);

		const actions = doc.createElement("div");
		actions.classList.add("keepsidian-notice-actions");
		const settingsButton = doc.createElement("button");
		settingsButton.classList.add("keepsidian-notice-button");
		settingsButton.textContent = "Open beta settings";
		settingsButton.setAttribute("aria-label", "Open beta settings");
		settingsButton.setAttribute("type", "button");
		actions.appendChild(settingsButton);
		fragment.appendChild(actions);

		let notice: Notice;
		settingsButton.addEventListener("click", () => {
			this.openTwoWaySettings();
			notice.hide();
		});

		notice = new Notice(fragment, 10000);
	}

	private autoSyncGateReasonsChanged(reasons: string[]): boolean {
		if (!this.lastAutoSyncGateReasons) {
			return true;
		}
		if (this.lastAutoSyncGateReasons.length !== reasons.length) {
			return true;
		}
		return this.lastAutoSyncGateReasons.some((reason, index) => reason !== reasons[index]);
	}

	private resetAutoSyncGateState() {
		this.lastAutoSyncGateReasons = null;
	}

	private async runAutoSyncTick(): Promise<void> {
		try {
			try {
				const subscriptionActive = await this.subscriptionService.isSubscriptionActive(
					true
				);
				this.subscriptionActive = subscriptionActive;
			} catch {
				// Notices are surfaced by SubscriptionService on failure; keep cached state.
			}

			const gate = await this.requireTwoWaySafeguards({ requireAutoSync: true });
			if (gate.allowed) {
				await this.performTwoWaySync();
				return;
			}

			await this.handleAutoSyncGate(gate.reasons);
		} catch (error: unknown) {
			const message = getErrorMessage(error);
			await logSync(this, `Auto sync upgrade check failed - ${message}`);
		}
	}

	private async handleAutoSyncGate(reasons: string[]): Promise<void> {
		if (reasons.length === 0) {
			return;
		}

		const reasonsChanged = this.autoSyncGateReasonsChanged(reasons);
		if (reasonsChanged) {
			this.lastAutoSyncGateReasons = [...reasons];
			this.showTwoWaySafeguardNotice({ allowed: false, reasons });
		}

		const formattedReasons = reasons.join("; ");
		await logSync(
			this,
			`Auto sync skipped uploads. Resolve in beta settings: ${formattedReasons}`
		);

		await this.importNotes(true);
	}

	refreshAutoSyncSafeguards() {
		this.normalizeTwoWaySettings();
		this.resetAutoSyncGateState();
	}

	openTwoWaySettings() {
		const pluginId = this.manifest?.id ?? "keepsidian";
		const settingManager = (
			this.app as unknown as {
				setting?: {
					open: () => void;
					openTabById?: (id: string) => void;
					openSettingTab?: (id: string) => void;
				};
			}
		).setting;
		if (settingManager?.open) {
			settingManager.open();
		}
		if (settingManager?.openTabById) {
			settingManager.openTabById(pluginId);
		} else if (settingManager?.openSettingTab) {
			settingManager.openSettingTab(pluginId);
		}
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
				getTwoWayGate: () => this.getTwoWayGateSnapshot(),
				requireTwoWayGate: () => this.requireTwoWaySafeguards(),
				showTwoWayGateNotice: (result) => this.showTwoWaySafeguardNotice(result),
				openTwoWaySettings: () => this.openTwoWaySettings(),
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

		if (!this.ensureCredentials()) {
			await logSync(this, `${auto ? "Auto" : "Manual"} sync aborted - missing credentials.`);
			return;
		}

		this.isSyncing = true;
		try {
			const isSubscriptionActive = await this.subscriptionService.isSubscriptionActive();
			this.subscriptionActive = isSubscriptionActive;

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
						`${
							auto ? "Auto" : "Manual"
						} sync ended - failed: ${errorMessage}. Processed ${
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

		if (!this.ensureCredentials()) {
			await logSync(this, "Push sync aborted - missing credentials.");
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
			this.progressContainerEl.classList.remove(HIDDEN_CLASS);
			this.progressContainerEl.classList.remove("complete", "failed");
			if (!this.progressContainerEl.classList.contains("indeterminate")) {
				this.progressContainerEl.classList.add("indeterminate");
			}
		}
		this.progressBar?.setValue(0);
		this.progressModal?.setProgress(0, undefined);
	}

	async performTwoWaySync() {
		if (this.isSyncing) {
			return;
		}

		if (!this.ensureCredentials()) {
			await logSync(this, "Two-way sync aborted - missing credentials.");
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
				this.resetAutoSyncGateState();
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
		this.refreshAutoSyncSafeguards();
		this.stopAutoSync();
		const intervalMs = this.settings.autoSyncIntervalHours * 60 * 60 * 1000;
		const runner = async () => {
			if (this.isSyncing) {
				return;
			}
			await this.runAutoSyncTick();
		};
		const intervalId = setInterval(() => {
			void runner();
		}, intervalMs);
		this.autoSyncInterval = intervalId;
		if (typeof this.registerInterval === "function" && typeof intervalId === "number") {
			this.registerInterval(intervalId);
		}
	}

	stopAutoSync() {
		if (this.autoSyncInterval) {
			clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = undefined;
		}
	}

	private async logSync(message: string) {
		/* moved to app/logging.ts */
	}
}
